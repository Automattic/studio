import fs from 'fs';
import path from 'path';
import {
	SKILL_LIMITS,
	skillEntry,
	type Skill,
	type SkillReadResult,
} from '@modelcontextprotocol/server/ext/skills';
import { selectUserSkills } from '@studio/agent/node';
import { readSkillsForAgent } from '@studio/common/lib/global-skills';
import { type UserSkill } from '@studio/common/lib/user-skills';

// The user's skills an outside agent can pick. Such an agent has no active site, so these are
// the skills for all sites. Read on every request: the user adds, changes and switches skills
// while the server runs.
const readUserSkills = async () => selectUserSkills( await readSkillsForAgent() );

// A skill's files by their path from its folder, or `null` for a skill past the limits a host
// supports. Hidden files are left out, and so are links, which could point outside the skill.
async function readSkillFiles( directory: string ): Promise< Map< string, Uint8Array > | null > {
	const entries = await fs.promises.readdir( directory, { recursive: true, withFileTypes: true } );
	const files = entries
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) =>
			path.relative( directory, path.join( entry.parentPath, entry.name ) ).split( path.sep )
		)
		.filter( ( parts ) => parts.every( ( part ) => ! part.startsWith( '.' ) ) )
		.map( ( parts ) => parts.join( '/' ) )
		.sort();
	if ( files.length > SKILL_LIMITS.files ) {
		return null;
	}
	const sizes = await Promise.all(
		files.map( async ( file ) => ( await fs.promises.stat( path.join( directory, file ) ) ).size )
	);
	if ( sizes.reduce( ( total, size ) => total + size, 0 ) > SKILL_LIMITS.bytes ) {
		return null;
	}
	const contents = await Promise.all(
		files.map( ( file ) => fs.promises.readFile( path.join( directory, file ) ) )
	);
	return new Map( files.map( ( file, index ) => [ file, contents[ index ] ] ) );
}

interface ServedSkill {
	// The skill as the Skills extension lists it, with the size and digest of each file.
	entry: Skill;
	files: Map< string, Uint8Array >;
}

// A skill a host would refuse is not served, such as one whose SKILL.md states another name
// than its folder's: studio_instructions still offers it.
async function serve( skill: UserSkill ): Promise< ServedSkill | undefined > {
	try {
		const files = await readSkillFiles( skill.directory );
		return files
			? { entry: await skillEntry( skill.name, Object.fromEntries( files ) ), files }
			: undefined;
	} catch {
		return undefined;
	}
}

export async function listServedSkills(): Promise< Skill[] > {
	const served = await Promise.all( ( await readUserSkills() ).map( serve ) );
	return served.flatMap( ( skill ) => ( skill ? [ skill.entry ] : [] ) );
}

// `skill://<name>/<file>`, as the entries name a skill's files.
function parseSkillUri( uri: string ): { name: string; file: string } | undefined {
	const match = /^skill:\/\/([^/]+)\/(.+)$/.exec( uri );
	if ( ! match ) {
		return undefined;
	}
	try {
		return {
			name: match[ 1 ],
			file: match[ 2 ].split( '/' ).map( decodeURIComponent ).join( '/' ),
		};
	} catch {
		return undefined;
	}
}

// The served skill a URI is in, and the file it names there.
async function findServedSkill( uri: string ) {
	const parsed = parseSkillUri( uri );
	const skill =
		parsed && ( await readUserSkills() ).find( ( candidate ) => candidate.name === parsed.name );
	const served = skill && ( await serve( skill ) );
	return served ? { ...served, file: parsed.file } : undefined;
}

// The entry of the skill whose SKILL.md is at `uri`.
export async function getServedSkill( uri: string ): Promise< Skill | undefined > {
	const found = await findServedSkill( uri );
	return found?.file === 'SKILL.md' ? found.entry : undefined;
}

// One file of a skill. Only the files its entry lists can be read.
export async function readServedSkillFile( uri: string ): Promise< SkillReadResult | undefined > {
	const found = await findServedSkill( uri );
	const bytes = found?.files.get( found.file );
	if ( ! found || ! bytes ) {
		return undefined;
	}
	const mimeType = found.file.endsWith( '.md' ) ? { mimeType: 'text/markdown' } : {};
	try {
		return { text: new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ), ...mimeType };
	} catch {
		return { bytes };
	}
}
