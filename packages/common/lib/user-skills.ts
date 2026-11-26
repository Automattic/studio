import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { Document, isMap, parse, parseDocument } from 'yaml';
import { isErrnoException } from './is-errno-exception';
import {
	getSkillDisplayName,
	getSkillId,
	SKILL_DESCRIPTION_MAX_LENGTH,
	SKILL_INSTRUCTIONS_MAX_LENGTH,
	SKILL_NAME_MAX_LENGTH,
	SKILL_NAME_PATTERN,
	type SkillDetails,
	type SkillDraft,
} from './skill-draft';

export { getSkillDisplayName };

// A skill the user keeps in a folder: `<folder>/<name>/SKILL.md`.
export interface UserSkill {
	// The folder's name, which is also the command: `/<name>`.
	name: string;
	// When agents use it. Empty when SKILL.md states none: agents can't pick such a skill.
	description: string;
	directory: string;
}

function splitSkillFile( contents: string ): { frontmatter: string; body: string } {
	const match = contents.match( /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/ );
	return match
		? { frontmatter: match[ 1 ], body: match[ 2 ] ?? '' }
		: { frontmatter: '', body: contents };
}

function readDescription( frontmatter: string ): string {
	let description: unknown;
	try {
		description = ( parse( frontmatter ) as { description?: unknown } | null )?.description;
	} catch {
		return '';
	}
	return typeof description === 'string'
		? description.replace( /\s+/g, ' ' ).trim().slice( 0, SKILL_DESCRIPTION_MAX_LENGTH )
		: '';
}

// The skills in a folder, sorted by name. A missing folder has none.
export async function readSkillsFolder( folder: string ): Promise< UserSkill[] > {
	let names: string[];
	try {
		names = await fs.promises.readdir( folder );
	} catch {
		return [];
	}
	const skills = await Promise.all(
		names
			.filter( ( name ) => SKILL_NAME_PATTERN.test( name ) && name.length <= SKILL_NAME_MAX_LENGTH )
			.sort()
			.map( async ( name ): Promise< UserSkill | null > => {
				const directory = path.join( folder, name );
				try {
					const contents = await fs.promises.readFile( path.join( directory, 'SKILL.md' ), 'utf8' );
					return {
						name,
						description: readDescription( splitSkillFile( contents ).frontmatter ),
						directory,
					};
				} catch {
					return null;
				}
			} )
	);
	return skills.filter( ( skill ) => skill !== null );
}

// A site's own skills. They are in the site's folder, so they move with the site.
export function readSiteSkills( sitePath: string ): Promise< UserSkill[] > {
	return readSkillsFolder( path.join( sitePath, '.agents', 'skills' ) );
}

// The instructions of a skill, read when an agent loads it, so they are always the latest.
export async function readUserSkillInstructions( skill: UserSkill ): Promise< string > {
	const contents = await fs.promises.readFile( path.join( skill.directory, 'SKILL.md' ), 'utf8' );
	return splitSkillFile( contents ).body.trim();
}

const MAX_LISTED_FILES = 50;

// The files of a skill by their path from its folder, SKILL.md first. Hidden files are left out.
async function listSkillFiles( directory: string ): Promise< string[] > {
	const entries = await fs.promises.readdir( directory, { recursive: true, withFileTypes: true } );
	const files = entries
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) =>
			path.relative( directory, path.join( entry.parentPath, entry.name ) ).split( path.sep )
		)
		.filter( ( parts ) => parts.every( ( part ) => ! part.startsWith( '.' ) ) )
		.map( ( parts ) => parts.join( '/' ) )
		.filter( ( file ) => file !== 'SKILL.md' )
		.sort();
	return [ 'SKILL.md', ...files ].slice( 0, MAX_LISTED_FILES );
}

// A skill as its editor shows it.
export async function readSkillDetails( skill: UserSkill ): Promise< SkillDetails > {
	const [ instructions, files ] = await Promise.all( [
		readUserSkillInstructions( skill ),
		listSkillFiles( skill.directory ),
	] );
	return {
		id: skill.name,
		displayName: getSkillDisplayName( skill.name ),
		description: skill.description,
		instructions,
		files,
	};
}

const alreadyExists = ( id: string ) =>
	/* translators: %s: a skill's command name, such as "lookbook-post". */
	new Error( sprintf( __( 'A skill named “%s” already exists.' ), id ) );

// The draft as it is saved, or an error that says what to fix. `taken` are the names
// another skill in the folder has, and `reserved` the names of Studio's own skills.
function checkSkillDraft(
	draft: SkillDraft,
	{ taken, reserved }: { taken: string[]; reserved: string[] }
) {
	const id = getSkillId( draft.name );
	const description = draft.description.replace( /\s+/g, ' ' ).trim();
	const instructions = draft.instructions.trim();
	if ( ! id ) {
		throw new Error( __( 'Give the skill a name with letters or numbers.' ) );
	}
	if ( id.length > SKILL_NAME_MAX_LENGTH ) {
		throw new Error( __( 'The name is too long.' ) );
	}
	if ( reserved.includes( id ) ) {
		throw new Error(
			/* translators: %s: a skill's command name, such as "build-site". */
			sprintf( __( 'Studio has its own skill named “%s”. Use another name.' ), id )
		);
	}
	if ( taken.includes( id ) ) {
		throw alreadyExists( id );
	}
	if ( ! description ) {
		throw new Error( __( 'Say when agents should use the skill.' ) );
	}
	if ( description.length > SKILL_DESCRIPTION_MAX_LENGTH ) {
		throw new Error( __( 'The description is too long.' ) );
	}
	if ( ! instructions ) {
		throw new Error( __( 'Write the instructions the agent must follow.' ) );
	}
	if ( instructions.length > SKILL_INSTRUCTIONS_MAX_LENGTH ) {
		throw new Error( __( 'The instructions are too long.' ) );
	}
	return { id, description, instructions };
}

// The frontmatter without its `name` and `description` keys, and the lines that continue them.
function withoutNameAndDescription( frontmatter: string ): string {
	let dropping = false;
	return frontmatter
		.split( /\r?\n/ )
		.filter( ( line ) => {
			if ( /^\S/.test( line ) ) {
				dropping = /^(?:name|description)\s*:/.test( line );
			}
			return ! dropping;
		} )
		.join( '\n' );
}

// SKILL.md with the name and description set. Other keys of an existing file stay.
function renderSkillFile(
	skill: { id: string; description: string; instructions: string },
	existing = ''
): string {
	const { frontmatter } = splitSkillFile( existing );
	let document: Document = parseDocument( frontmatter );
	if ( document.errors.length ) {
		// YAML often can't read a description with a colon in it: the other keys stay without it.
		document = parseDocument( withoutNameAndDescription( frontmatter ) );
	}
	if ( document.errors.length || ! isMap( document.contents ) ) {
		document = new Document( {} );
	}
	document.set( 'name', skill.id );
	document.set( 'description', skill.description );
	return `---\n${ document.toString( { lineWidth: 0 } ).trim() }\n---\n\n${ skill.instructions }\n`;
}

/** Saves a new skill in `folder` and returns its name. Never writes over another skill. */
export async function createSkillInFolder(
	folder: string,
	draft: SkillDraft,
	names: { taken: string[]; reserved: string[] }
): Promise< string > {
	const skill = checkSkillDraft( draft, names );
	const directory = path.join( folder, skill.id );
	await fs.promises.mkdir( folder, { recursive: true } );
	try {
		await fs.promises.mkdir( directory );
	} catch ( error ) {
		throw isErrnoException( error ) && error.code === 'EEXIST' ? alreadyExists( skill.id ) : error;
	}
	await fs.promises.writeFile( path.join( directory, 'SKILL.md' ), renderSkillFile( skill ) );
	return skill.id;
}

/**
 * Saves changes to a skill and returns its name. A new name moves the skill's folder, so its
 * command changes with it.
 */
export async function updateSkillInFolder(
	current: UserSkill,
	draft: SkillDraft,
	names: { taken: string[]; reserved: string[] }
): Promise< string > {
	const skill = checkSkillDraft( draft, {
		reserved: names.reserved,
		taken: names.taken.filter( ( name ) => name !== current.name ),
	} );
	const existing = await fs.promises.readFile( path.join( current.directory, 'SKILL.md' ), 'utf8' );
	let directory = current.directory;
	if ( skill.id !== current.name ) {
		// The folder moves before the file is written: a move that fails changes nothing.
		directory = path.join( path.dirname( current.directory ), skill.id );
		// `taken` has only the folders with a SKILL.md.
		if ( await fs.promises.lstat( directory ).catch( () => null ) ) {
			throw alreadyExists( skill.id );
		}
		await fs.promises.rename( current.directory, directory );
	}
	await fs.promises.writeFile(
		path.join( directory, 'SKILL.md' ),
		renderSkillFile( skill, existing )
	);
	return skill.id;
}
