import fs from 'fs';
import path from 'path';
import { readConfig, updateConfig } from './config/store';
import { arePathsEqual } from './fs-utils';
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

// Where a skill for all sites is kept: Studio's own folder, or the folder the
// other agents on this computer read (`~/.agents/skills`).
export type GlobalSkillSource = 'studio' | 'agents';

export interface GlobalSkill {
	id: string;
	displayName: string;
	// Empty for a skill whose SKILL.md states none: agents can't pick such a skill.
	description: string;
	enabled: boolean;
	source: GlobalSkillSource;
	directory: string;
}

const toGlobalSkill = (
	skill: UserSkill,
	source: GlobalSkillSource,
	enabled: boolean
): GlobalSkill => ( {
	id: skill.name,
	displayName: getSkillDisplayName( skill.name ),
	description: skill.description,
	enabled,
	source,
	directory: skill.directory,
} );

/**
 * The user's skills for all sites. Studio's own are on or off by the folder they
 * are in. The ones in `~/.agents/skills` stay where the other agents read them,
 * so they are always the latest version, and are off until switched on.
 */
export async function getGlobalSkills(): Promise< GlobalSkill[] > {
	const [ enabled, disabled, agents, config ] = await Promise.all( [
		readSkillsFolder( getGlobalSkillsDirectory() ),
		readSkillsFolder( getDisabledGlobalSkillsDirectory() ),
		readSkillsFolder( getAgentsSkillsDirectory() ),
		readConfig(),
	] );
	const switchedOn = config.preferences.agentsSkills ?? [];
	return [
		...[
			...enabled.map( ( skill ) => toGlobalSkill( skill, 'studio', true ) ),
			...disabled
				.filter( ( skill ) => ! enabled.some( ( { name } ) => name === skill.name ) )
				.map( ( skill ) => toGlobalSkill( skill, 'studio', false ) ),
		].sort( ( a, b ) => a.id.localeCompare( b.id ) ),
		...agents.map( ( skill ) =>
			toGlobalSkill( skill, 'agents', switchedOn.includes( skill.name ) )
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

export async function setGlobalSkillEnabled(
	source: GlobalSkillSource,
	requestedId: string,
	enabled: boolean
): Promise< void > {
	const skill = await findGlobalSkill( source, requestedId );
	if ( source === 'agents' ) {
		await updateConfig( ( { preferences } ) => {
			const others = ( preferences.agentsSkills ?? [] ).filter( ( id ) => id !== skill.id );
			preferences.agentsSkills = enabled ? [ ...others, skill.id ] : others;
		} );
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

// Deletes one of Studio's own. The ones in `~/.agents/skills` belong to the other agents too.
export async function removeGlobalSkill( requestedId: string ): Promise< void > {
	const skill = await findGlobalSkill( 'studio', requestedId );
	await fs.promises.rm( skill.directory, { recursive: true, force: true } );
}

const toUserSkill = ( skill: GlobalSkill ): UserSkill => ( {
	name: skill.id,
	description: skill.description,
	directory: skill.directory,
} );

// The names Studio's own global skills have, on or off.
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

// One of Studio's own, opened to change it. The other agents' skills are changed in their folder.
export async function getGlobalSkillDetails( requestedId: string ): Promise< SkillDetails > {
	return readSkillDetails( toUserSkill( await findGlobalSkill( 'studio', requestedId ) ) );
}

export async function updateGlobalSkill(
	requestedId: string,
	draft: SkillDraft,
	reserved: string[]
): Promise< string > {
	const skill = await findGlobalSkill( 'studio', requestedId );
	return updateSkillInFolder( toUserSkill( skill ), draft, {
		taken: await readStudioSkillNames(),
		reserved,
	} );
}

// The folder of a global skill, for a file manager.
export async function getGlobalSkillDirectory(
	source: GlobalSkillSource,
	requestedId: string
): Promise< string > {
	return ( await findGlobalSkill( source, requestedId ) ).directory;
}

async function readSiteRecord( sitePath: string ) {
	return ( await readConfig() ).sites.find( ( candidate ) =>
		arePathsEqual( candidate.path, sitePath )
	);
}

/**
 * The global skills a site can use: the ones that are on, with whether this site
 * switched each off. Studio's own come before another agent's of the same name.
 */
export async function getGlobalSkillsForSite(
	sitePath: string
): Promise< Array< GlobalSkill & { enabledOnSite: boolean } > > {
	const [ skills, disabled ] = await Promise.all( [
		getGlobalSkills(),
		readSiteRecord( sitePath ).then( ( site ) => site?.disabledGlobalSkills ?? [] ),
	] );
	return skills
		.filter(
			( skill, index ) =>
				skill.enabled &&
				skills.findIndex( ( { id, enabled } ) => enabled && id === skill.id ) === index
		)
		.map( ( skill ) => ( { ...skill, enabledOnSite: ! disabled.includes( skill.id ) } ) );
}

export async function setGlobalSkillEnabledOnSite(
	sitePath: string,
	id: string,
	enabled: boolean
): Promise< void > {
	const siteId = ( await readSiteRecord( sitePath ) )?.id;
	await updateConfig( ( { sites } ) => {
		const site = sites.find( ( candidate ) => candidate.id === siteId );
		if ( ! site ) {
			throw new Error( 'Site not found.' );
		}
		const others = ( site.disabledGlobalSkills ?? [] ).filter( ( skill ) => skill !== id );
		site.disabledGlobalSkills = enabled ? others : [ ...others, id ];
	} );
}

/**
 * The user's skills an agent can load: the site's own, then the global ones the
 * site did not switch off. A skill in the site's folder, on or off, takes the
 * place of a global one with its name. Without a site, the global ones.
 */
export async function readSkillsForAgent( sitePath?: string ): Promise< UserSkill[] > {
	if ( ! sitePath ) {
		const skills = ( await getGlobalSkills() ).filter( ( skill ) => skill.enabled );
		return skills
			.filter( ( skill, index ) => skills.findIndex( ( { id } ) => id === skill.id ) === index )
			.map( toUserSkill );
	}
	const [ own, inFolder, global ] = await Promise.all( [
		readSiteSkills( sitePath ),
		readSiteSkillNames( sitePath ),
		getGlobalSkillsForSite( sitePath ),
	] );
	return [
		...own,
		...global
			.filter( ( skill ) => skill.enabledOnSite && ! inFolder.includes( skill.id ) )
			.map( toUserSkill ),
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
