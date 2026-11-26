import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { isErrnoException } from './is-errno-exception';
import {
	createSkillInFolder,
	getSkillDisplayName,
	readSiteSkills,
	readSkillDetails,
	readSkillsFolder,
	updateSkillInFolder,
	type UserSkill,
} from './user-skills';
import {
	getAgentsSkillsDirectory,
	getDisabledGlobalSkillsDirectory,
	getGlobalSkillsDirectory,
} from './well-known-paths';
import type { SkillDetails, SkillDraft } from './skill-draft';

// Where a skill is found: Studio's folder for all sites, or the folder the other agents on
// this computer read (`~/.agents/skills`).
export type GlobalSkillSource = 'studio' | 'agents';

export interface GlobalSkill {
	id: string;
	displayName: string;
	// Empty for a skill whose SKILL.md states none: agents can't pick such a skill.
	description: string;
	// For one in Studio's folder: agents can load it. For one in `~/.agents/skills`: Studio's
	// folder has a link to it.
	enabled: boolean;
	source: GlobalSkillSource;
	directory: string;
	// In Studio's folder as a link to a skill in `~/.agents/skills`: a change or a delete in
	// Studio reaches the other agents too.
	linked?: boolean;
}

async function isLink( filePath: string ): Promise< boolean > {
	try {
		return ( await fs.promises.lstat( filePath ) ).isSymbolicLink();
	} catch {
		return false;
	}
}

// The skills in one of Studio's two folders, each with whether it is a link.
async function readStudioFolder( folder: string, enabled: boolean ): Promise< GlobalSkill[] > {
	return Promise.all(
		( await readSkillsFolder( folder ) ).map( async ( skill ) => ( {
			id: skill.name,
			displayName: getSkillDisplayName( skill.name ),
			description: skill.description,
			enabled,
			source: 'studio' as const,
			directory: skill.directory,
			...( ( await isLink( skill.directory ) ) ? { linked: true } : {} ),
		} ) )
	);
}

/**
 * The user's skills for all sites: the ones in Studio's folder, on or off by the folder they
 * are in. Then the ones found in `~/.agents/skills`: adding one puts a link to it in Studio's
 * folder, so Studio always reads the latest version and the files stay where they are.
 */
export async function getGlobalSkills(): Promise< GlobalSkill[] > {
	const [ enabled, disabled, agents ] = await Promise.all( [
		readStudioFolder( getGlobalSkillsDirectory(), true ),
		readStudioFolder( getDisabledGlobalSkillsDirectory(), false ),
		readSkillsFolder( getAgentsSkillsDirectory() ),
	] );
	const studio = [
		...enabled,
		...disabled.filter( ( skill ) => ! enabled.some( ( { id } ) => id === skill.id ) ),
	].sort( ( a, b ) => a.id.localeCompare( b.id ) );
	return [
		...studio,
		...agents.map(
			( skill ): GlobalSkill => ( {
				id: skill.name,
				displayName: getSkillDisplayName( skill.name ),
				description: skill.description,
				enabled: studio.some( ( { id, linked } ) => linked && id === skill.name ),
				source: 'agents',
				directory: skill.directory,
			} )
		),
	];
}

// The skill as Studio found it: paths are never built from a requested id.
async function findGlobalSkill( source: GlobalSkillSource, id: string ): Promise< GlobalSkill > {
	const skill = ( await getGlobalSkills() ).find(
		( candidate ) => candidate.source === source && candidate.id === id
	);
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ id }` );
	}
	return skill;
}

// Where a skill of this name is, or would be, in Studio's two folders.
const studioLocations = ( id: string ) =>
	[ getGlobalSkillsDirectory(), getDisabledGlobalSkillsDirectory() ].map( ( folder ) =>
		path.join( folder, id )
	);

// Adds a skill from `~/.agents/skills` to Studio as a link, or takes the link away. Only a
// link is ever removed here: a folder of the same name is one of Studio's own.
async function setAgentsSkillLinked( skill: GlobalSkill, linked: boolean ): Promise< void > {
	const [ link, ...others ] = studioLocations( skill.id );
	for ( const location of [ link, ...others ] ) {
		if ( await isLink( location ) ) {
			await fs.promises.rm( location, { force: true } );
		}
	}
	if ( ! linked ) {
		return;
	}
	try {
		await linkSkill( skill.directory, link );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'EEXIST' ) {
			throw new Error(
				/* translators: %s: a skill's command name, such as "lookbook-post". */
				sprintf( __( 'Studio already has a skill named “%s”.' ), skill.id )
			);
		}
		throw error;
	}
}

async function linkSkill( target: string, link: string ): Promise< void > {
	await fs.promises.mkdir( path.dirname( link ), { recursive: true } );
	// A junction needs no administrator rights on Windows.
	await fs.promises.symlink( target, link, process.platform === 'win32' ? 'junction' : 'dir' );
}

export async function setGlobalSkillEnabled(
	source: GlobalSkillSource,
	requestedId: string,
	enabled: boolean
): Promise< void > {
	const skill = await findGlobalSkill( source, requestedId );
	if ( source === 'agents' ) {
		await setAgentsSkillLinked( skill, enabled );
		return;
	}
	if ( skill.enabled === enabled ) {
		return;
	}
	// A switched-off skill keeps its files, out of the folder agents read.
	const to = path.join(
		enabled ? getGlobalSkillsDirectory() : getDisabledGlobalSkillsDirectory(),
		skill.id
	);
	await fs.promises.mkdir( path.dirname( to ), { recursive: true } );
	await fs.promises.rename( skill.directory, to );
}

// Deletes a skill of Studio's folder. A linked one goes from `~/.agents/skills` too, so from
// the other agents; a link that points somewhere else only loses its link.
export async function removeGlobalSkill( requestedId: string ): Promise< void > {
	const skill = await findGlobalSkill( 'studio', requestedId );
	if ( ! skill.linked ) {
		await fs.promises.rm( skill.directory, { recursive: true, force: true } );
		return;
	}
	const [ target, agents ] = await Promise.all( [
		fs.promises.realpath( skill.directory ),
		// Without that folder, the link points somewhere else.
		fs.promises.realpath( getAgentsSkillsDirectory() ).catch( () => null ),
	] );
	await fs.promises.rm( skill.directory, { force: true } );
	if ( path.dirname( target ) === agents ) {
		await fs.promises.rm( target, { recursive: true, force: true } );
	}
}

const toUserSkill = ( skill: GlobalSkill ): UserSkill => ( {
	name: skill.id,
	description: skill.description,
	directory: skill.directory,
} );

// The names the skills in Studio's folder have, on or off.
async function readStudioSkillNames(): Promise< string[] > {
	return ( await getGlobalSkills() )
		.filter( ( skill ) => skill.source === 'studio' )
		.map( ( skill ) => skill.id );
}

/** Saves a new skill for all sites in Studio's folder, and returns its name. */
export async function createGlobalSkill(
	draft: SkillDraft,
	reserved: string[]
): Promise< string > {
	return createSkillInFolder( getGlobalSkillsDirectory(), draft, {
		taken: await readStudioSkillNames(),
		reserved,
	} );
}

export async function getGlobalSkillDetails( requestedId: string ): Promise< SkillDetails > {
	return readSkillDetails( toUserSkill( await findGlobalSkill( 'studio', requestedId ) ) );
}

/**
 * Saves changes to a skill in Studio's folder and returns its name. A linked skill changes
 * where it is kept, so for the other agents too: a new name moves that folder, and the link
 * with it.
 */
export async function updateGlobalSkill(
	requestedId: string,
	draft: SkillDraft,
	reserved: string[]
): Promise< string > {
	const skill = await findGlobalSkill( 'studio', requestedId );
	const taken = await readStudioSkillNames();
	if ( ! skill.linked ) {
		return updateSkillInFolder( toUserSkill( skill ), draft, { taken, reserved } );
	}
	const target = await fs.promises.realpath( skill.directory );
	const neighbors = await readSkillsFolder( path.dirname( target ) );
	const id = await updateSkillInFolder(
		{ ...toUserSkill( skill ), name: path.basename( target ), directory: target },
		draft,
		{
			// The folder's own name is free to keep; Studio's name for the link is too.
			taken: [
				...taken.filter( ( name ) => name !== skill.id ),
				...neighbors.map( ( neighbor ) => neighbor.name ),
			],
			reserved,
		}
	);
	// The link is made again when its own name changed, or its folder's: a link Studio did not
	// make can have another name than the folder it points at.
	if ( id !== skill.id || id !== path.basename( target ) ) {
		await fs.promises.rm( skill.directory, { force: true } );
		await linkSkill(
			path.join( path.dirname( target ), id ),
			path.join( path.dirname( skill.directory ), id )
		);
	}
	return id;
}

// The folder of a global skill, for a file manager.
export async function getGlobalSkillDirectory(
	source: GlobalSkillSource,
	requestedId: string
): Promise< string > {
	return ( await findGlobalSkill( source, requestedId ) ).directory;
}

// The global skills agents can load: the ones in Studio's folder that are on.
export async function getEnabledGlobalSkills(): Promise< GlobalSkill[] > {
	return ( await getGlobalSkills() ).filter(
		( skill ) => skill.source === 'studio' && skill.enabled
	);
}

/**
 * The user's skills an agent can load: the site's own, then the global ones that are
 * on. A skill in the site's folder, on or off, takes the place of a global one with
 * its name. Without a site, the global ones.
 */
export async function readSkillsForAgent( sitePath?: string ): Promise< UserSkill[] > {
	if ( ! sitePath ) {
		return ( await getEnabledGlobalSkills() ).map( toUserSkill );
	}
	const [ own, inFolder, global ] = await Promise.all( [
		readSiteSkills( sitePath ),
		readSiteSkillNames( sitePath ),
		getEnabledGlobalSkills(),
	] );
	return [
		...own,
		...global.filter( ( skill ) => ! inFolder.includes( skill.id ) ).map( toUserSkill ),
	];
}

// The names of the skills in a site's folder, on or off.
export async function readSiteSkillNames( sitePath: string ): Promise< string[] > {
	const folders = await Promise.all(
		[ 'skills', 'disabled-skills' ].map( ( folder ) =>
			readSkillsFolder( path.join( sitePath, '.agents', folder ) )
		)
	);
	return folders.flat().map( ( skill ) => skill.name );
}
