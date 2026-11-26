import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { readSitePaths } from '../sites/site-path';
import { readConfig, updateConfig } from './config/store';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { getEnabledGlobalSkills, type GlobalSkillSource } from './global-skills';
import { isErrnoException } from './is-errno-exception';
import {
	createSkillInFolder,
	getSkillDisplayName,
	readSkillDetails,
	readSkillsFolder,
	updateSkillInFolder,
	type UserSkill,
} from './user-skills';
import { SHIPPED_SKILL_IDS, type SkillDetails, type SkillDraft } from './skill-draft';

/**
 * Managed instruction files that are always kept up-to-date on server start.
 * These are overwritten with the bundled version whenever they already exist in a site.
 */
const MANAGED_INSTRUCTION_FILES = [ 'STUDIO.md' ];

/**
 * Install all bundled AI instructions and skills from a source directory into a site.
 *
 * Source directory layout (flat):
 *   AGENTS.md, CLAUDE.md, STUDIO.md — loose .md files rendered and written to site root
 *   studio-cli/SKILL.md             — directories are skills, installed to .agents/skills/
 *   wp-plugin-development/SKILL.md
 *
 * Site directory layout after install:
 *   AGENTS.md, CLAUDE.md, STUDIO.md
 *   .agents/skills/<id>/SKILL.md
 *   .claude/skills/<id> -> ../../.agents/skills/<id>
 */
export async function installAiInstructionsToSite(
	site: { path: string },
	bundledPath: string,
	userSelectedGlobalSkills: string[] = [],
	overwrite: boolean = false
): Promise< void > {
	if ( ! ( await pathExists( bundledPath ) ) ) {
		return;
	}

	const entries = await fs.promises.readdir( bundledPath, { withFileTypes: true } );

	const tasks: Promise< void >[] = [];
	for ( const entry of entries ) {
		if ( entry.isFile() && entry.name.endsWith( '.md' ) ) {
			if ( ! ( await isSiteAgentFileDisabled( site.path, 'instructions', entry.name ) ) ) {
				tasks.push( installInstructionFile( site.path, bundledPath, entry.name, overwrite ) );
			}
		} else if ( entry.isDirectory() && userSelectedGlobalSkills.includes( entry.name ) ) {
			if ( ! ( await isSiteAgentFileDisabled( site.path, 'skills', entry.name ) ) ) {
				tasks.push( installSkillToSite( site, bundledPath, entry.name, overwrite ) );
			}
		}
	}

	const results = await Promise.allSettled( tasks );
	for ( const result of results ) {
		if ( result.status === 'rejected' ) {
			console.error( '[ai-skills] Failed to install:', result.reason );
		}
	}
}

/**
 * Update managed instruction files in a site if they already exist, replacing them
 * with the bundled version. Called on server start to keep Studio-managed instructions current.
 */
export async function updateManagedInstructionFiles(
	site: { path: string },
	bundledPath: string
): Promise< void > {
	for ( const fileName of MANAGED_INSTRUCTION_FILES ) {
		const dest = path.join( site.path, fileName );
		const src = path.join( bundledPath, fileName );

		if ( ! ( await pathExists( dest ) ) || ! ( await pathExists( src ) ) ) {
			continue;
		}

		await fs.promises.copyFile( src, dest );
	}
}

async function installInstructionFile(
	sitePath: string,
	bundledPath: string,
	fileName: string,
	overwrite: boolean
): Promise< void > {
	const dest = path.join( sitePath, fileName );
	if ( ( await pathExists( dest ) ) && ! overwrite ) {
		return;
	}
	await fs.promises.copyFile( path.join( bundledPath, fileName ), dest );
}

export async function removeSkillFromSite( sitePath: string, skillId: string ): Promise< void > {
	await removeSiteAgentFile( sitePath, 'skills', skillId );
}

export async function installSkillToSite(
	site: { path: string },
	bundledPath: string,
	skillId: string,
	overwrite: boolean
): Promise< void > {
	const id = getBundledSkills().find( ( skill ) => skill.id === skillId )?.id;
	if ( ! id ) {
		return;
	}
	// A skill switched off on this site comes back with its edits.
	await moveSiteAgentFile( site.path, 'skills', id, true );
	const src = path.join( bundledPath, id );
	if ( ! ( await pathExists( src ) ) ) {
		return;
	}

	const agentsSkillPath = path.join( site.path, '.agents', 'skills', id );
	const claudeSkillPath = path.join( site.path, '.claude', 'skills', id );

	const isInstalled = await pathExists( path.join( agentsSkillPath, 'SKILL.md' ) );

	if ( ! isInstalled || overwrite ) {
		if ( overwrite ) {
			await fs.promises.rm( agentsSkillPath, { recursive: true, force: true } );
		}
		await recursiveCopyDirectory( src, agentsSkillPath );
	}

	await ensureSkillSymlink( site.path, agentsSkillPath, claudeSkillPath, overwrite );
}

async function ensureSkillSymlink(
	sitePath: string,
	agentsSkillPath: string,
	claudeSkillPath: string,
	overwrite: boolean
): Promise< void > {
	await fs.promises.mkdir( path.join( sitePath, '.claude', 'skills' ), { recursive: true } );
	const relativePath = path.relative( path.join( sitePath, '.claude', 'skills' ), agentsSkillPath );

	if ( overwrite ) {
		await fs.promises.rm( claudeSkillPath, { recursive: true, force: true } );
	} else if ( await pathExists( claudeSkillPath ) ) {
		return;
	}

	try {
		await fs.promises.symlink( relativePath, claudeSkillPath );
	} catch ( error ) {
		// On Windows, symlinks may require admin privileges or Developer Mode.
		// Fall back to a directory junction which doesn't require elevated permissions.
		if ( isErrnoException( error ) && error.code === 'EPERM' && process.platform === 'win32' ) {
			await fs.promises.symlink( path.resolve( agentsSkillPath ), claudeSkillPath, 'junction' );
		} else {
			throw error;
		}
	}
}

export interface SkillStatus {
	id: string;
	displayName: string;
	description: string;
	installed: boolean;
}

export const getBundledSkills = () => [
	{
		id: 'studio-cli',
		displayName: __( 'Studio CLI' ),
		description: __( 'WordPress development workflows using Studio CLI' ),
	},
	{
		id: 'wp-plugin-development',
		displayName: __( 'Plugin Development' ),
		description: __( 'Hooks, settings API, security, and packaging' ),
	},
	{
		id: 'wp-block-development',
		displayName: __( 'Block Development' ),
		description: __( 'Block.json, attributes, rendering, and deprecations' ),
	},
	{
		id: 'wp-block-themes',
		displayName: __( 'Block Themes' ),
		description: __( 'Theme.json, templates, patterns, and style variations' ),
	},
	{
		id: 'wp-rest-api',
		displayName: __( 'REST API' ),
		description: __( 'Routes, endpoints, schema, and authentication' ),
	},
	{
		id: 'wp-wpcli-and-ops',
		displayName: __( 'WP-CLI & Ops' ),
		description: __( 'CLI commands, automation, and search-replace' ),
	},
];

// "Installed" means selected for every site: new sites get it too, on creation.
export async function getSkillsStatusForAllSites(): Promise< SkillStatus[] > {
	const selectedSkills = ( await readConfig() ).preferences.selectedSkills ?? [];
	return getBundledSkills().map( ( skill ) => ( {
		...skill,
		installed: selectedSkills.includes( skill.id ),
	} ) );
}

export async function installSkillToAllSites(
	bundledPath: string,
	skillId: string,
	overwrite = false
): Promise< void > {
	await forEachSite( ( sitePath ) =>
		installSkillToSite( { path: sitePath }, bundledPath, skillId, overwrite )
	);
	await updateConfig( ( { preferences } ) => {
		preferences.selectedSkills = Array.from(
			new Set( [ ...( preferences.selectedSkills ?? [] ), skillId ] )
		);
	} );
}

export async function removeSkillFromAllSites( skillId: string ): Promise< void > {
	await forEachSite( ( sitePath ) => removeSkillFromSite( sitePath, skillId ) );
	await updateConfig( ( { preferences } ) => {
		preferences.selectedSkills = preferences.selectedSkills?.filter( ( id ) => id !== skillId );
	} );
}

// One site failing (moved, unreadable) shouldn't stop the others.
async function forEachSite( operation: ( sitePath: string ) => Promise< void > ): Promise< void > {
	const results = await Promise.allSettled( ( await readSitePaths() ).map( operation ) );
	for ( const result of results ) {
		if ( result.status === 'rejected' ) {
			console.error( '[skills] Failed to update a site:', result.reason );
		}
	}
}

export type SiteAgentFileKind = 'skills' | 'instructions';

export interface SiteAgentFile {
	id: string;
	displayName: string;
	// Empty for a skill whose SKILL.md states none: agents can't pick such a skill.
	description: string;
	// Present on the site, switched on or off.
	installed: boolean;
	// Where agents find it.
	enabled: boolean;
	// Set for a skill that works on all sites, which is changed for all sites, not here: where
	// the skill is kept.
	globalSource?: GlobalSkillSource;
}

const getInstructionFiles = () => [
	{
		id: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: __( 'Instructions for Codex, Goose, and other AI agents.' ),
	},
	{
		id: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: __( 'Points Claude Code to AGENTS.md.' ),
	},
	{
		id: 'STUDIO.md',
		displayName: 'STUDIO.md',
		description: __( 'Studio-specific WordPress development instructions.' ),
	},
];

// A switched-off file keeps its content, out of the folders agents read.
function getLocations( sitePath: string, kind: SiteAgentFileKind, id: string ) {
	if ( kind === 'instructions' ) {
		return [
			{
				enabled: path.join( sitePath, id ),
				disabled: path.join( sitePath, '.agents', 'disabled-instructions', id ),
			},
		];
	}
	return [ '.agents', '.claude' ].map( ( owner ) => ( {
		enabled: path.join( sitePath, owner, 'skills', id ),
		disabled: path.join( sitePath, owner, 'disabled-skills', id ),
	} ) );
}

// The skills in the site's folder, switched on or off: the ones Studio installed
// and the ones the user or an agent saved there.
async function getSiteFolderSkills( sitePath: string ): Promise< SiteAgentFile[] > {
	// Skills live in `.agents`; `.claude` only links to them.
	const [ enabled, disabled ] = await Promise.all(
		[ 'skills', 'disabled-skills' ].map( ( folder ) =>
			readSkillsFolder( path.join( sitePath, '.agents', folder ) )
		)
	);
	const bundled = getBundledSkills();
	const toFile = ( skill: UserSkill, isEnabled: boolean ): SiteAgentFile => ( {
		id: skill.name,
		displayName: getSkillDisplayName( skill.name ),
		description: skill.description,
		...bundled.find( ( candidate ) => candidate.id === skill.name ),
		installed: true,
		enabled: isEnabled,
	} );
	return [
		...enabled.map( ( skill ) => toFile( skill, true ) ),
		...disabled
			.filter( ( skill ) => ! enabled.some( ( { name } ) => name === skill.name ) )
			.map( ( skill ) => toFile( skill, false ) ),
	].sort( ( a, b ) => a.id.localeCompare( b.id ) );
}

// The skills in a site's folder, as they are on disk: the ones that are on come first.
async function readSiteFolderSkills( sitePath: string ): Promise< UserSkill[] > {
	const folders = await Promise.all(
		[ 'skills', 'disabled-skills' ].map( ( folder ) =>
			readSkillsFolder( path.join( sitePath, '.agents', folder ) )
		)
	);
	return folders.flat();
}

async function findSiteFolderSkill( sitePath: string, requestedId: string ): Promise< UserSkill > {
	const skill = ( await readSiteFolderSkills( sitePath ) ).find(
		( candidate ) => candidate.name === requestedId
	);
	if ( ! skill ) {
		throw new Error( `Unknown skill: ${ requestedId }` );
	}
	return skill;
}

/**
 * Saves a new skill in the site's folder, and returns its name. It can't take the name of a
 * WordPress skill Studio ships: the site would show it as that skill.
 */
export async function createSiteSkill(
	sitePath: string,
	draft: SkillDraft,
	reserved: string[]
): Promise< string > {
	return createSkillInFolder( path.join( sitePath, '.agents', 'skills' ), draft, {
		taken: ( await readSiteFolderSkills( sitePath ) ).map( ( skill ) => skill.name ),
		reserved: [ ...reserved, ...SHIPPED_SKILL_IDS ],
	} );
}

// One of the site's own skills, opened to change it.
export async function getSiteSkillDetails(
	sitePath: string,
	requestedId: string
): Promise< SkillDetails > {
	return readSkillDetails( await findSiteFolderSkill( sitePath, requestedId ) );
}

export async function updateSiteSkill(
	sitePath: string,
	requestedId: string,
	draft: SkillDraft,
	reserved: string[]
): Promise< string > {
	const skill = await findSiteFolderSkill( sitePath, requestedId );
	const id = await updateSkillInFolder( skill, draft, {
		taken: ( await readSiteFolderSkills( sitePath ) ).map( ( candidate ) => candidate.name ),
		// A shipped skill the site has keeps its name.
		reserved: [ ...reserved, ...SHIPPED_SKILL_IDS.filter( ( shipped ) => shipped !== skill.name ) ],
	} );
	if ( id !== skill.name ) {
		// The `.claude` link points at the old folder: Claude Code gets one for the new name.
		const [ , claude ] = getLocations( sitePath, 'skills', skill.name );
		const wasLinked = await exists( claude.enabled );
		await fs.promises.rm( claude.enabled, { recursive: true, force: true } );
		await fs.promises.rm( claude.disabled, { recursive: true, force: true } );
		if ( wasLinked ) {
			const [ agents, renamed ] = getLocations( sitePath, 'skills', id );
			await ensureSkillSymlink( sitePath, agents.enabled, renamed.enabled, true );
		}
	}
	return id;
}

// What agents can use on a site: its own skills, then the global ones that are on. A skill
// in the site's folder takes the place of a global one with its name.
async function getSiteSkills( sitePath: string ): Promise< SiteAgentFile[] > {
	const [ own, global ] = await Promise.all( [
		getSiteFolderSkills( sitePath ),
		getEnabledGlobalSkills(),
	] );
	return [
		...own,
		...global
			.filter( ( skill ) => ! own.some( ( { id } ) => id === skill.id ) )
			.map( ( skill ) => ( {
				id: skill.id,
				displayName: skill.displayName,
				description: skill.description,
				installed: true,
				enabled: true,
				globalSource: skill.source,
			} ) ),
	];
}

export async function getSiteAgentFiles(
	sitePath: string,
	kind: SiteAgentFileKind
): Promise< SiteAgentFile[] > {
	if ( kind === 'skills' ) {
		return getSiteSkills( sitePath );
	}
	return Promise.all(
		getInstructionFiles().map( async ( file ) => {
			const [ location ] = getLocations( sitePath, kind, file.id );
			const enabled = await pathExists( location.enabled );
			return {
				...file,
				enabled,
				installed: enabled || ( await pathExists( location.disabled ) ),
			};
		} )
	);
}

// Whether a file was switched off on this site, so installs leave it off.
function isSiteAgentFileDisabled( sitePath: string, kind: SiteAgentFileKind, id: string ) {
	return pathExists( getLocations( sitePath, kind, id )[ 0 ].disabled );
}

// Moves a file between where agents find it and where switched-off files wait.
async function moveSiteAgentFile(
	sitePath: string,
	kind: SiteAgentFileKind,
	id: string,
	enabled: boolean
): Promise< boolean > {
	let moved = false;
	for ( const location of getLocations( sitePath, kind, id ) ) {
		const from = enabled ? location.disabled : location.enabled;
		const to = enabled ? location.enabled : location.disabled;
		if ( ! ( await exists( from ) ) ) {
			continue;
		}
		await fs.promises.rm( to, { recursive: true, force: true } );
		await fs.promises.mkdir( path.dirname( to ), { recursive: true } );
		await fs.promises.rename( from, to );
		moved = true;
	}
	return moved;
}

export async function setSiteAgentFileEnabled(
	sitePath: string,
	bundledPath: string,
	kind: SiteAgentFileKind,
	requestedId: string,
	enabled: boolean
): Promise< void > {
	const id = await getKnownFileId( sitePath, kind, requestedId );
	const moved = await moveSiteAgentFile( sitePath, kind, id, enabled );
	// Switching on a file the site never had installs it.
	if ( enabled && ! moved ) {
		if ( kind === 'skills' ) {
			await installSkillToSite( { path: sitePath }, bundledPath, id, false );
		} else {
			await fs.promises.copyFile( path.join( bundledPath, id ), path.join( sitePath, id ) );
		}
	}
}

export async function removeSiteAgentFile(
	sitePath: string,
	kind: SiteAgentFileKind,
	requestedId: string
): Promise< void > {
	const id = await getKnownFileId( sitePath, kind, requestedId );
	for ( const location of getLocations( sitePath, kind, id ) ) {
		await fs.promises.rm( location.enabled, { recursive: true, force: true } );
		await fs.promises.rm( location.disabled, { recursive: true, force: true } );
	}
}

// Paths are built from an id Studio found or ships, never the requested one.
async function getKnownFileId(
	sitePath: string,
	kind: SiteAgentFileKind,
	requestedId: string
): Promise< string > {
	const known =
		kind === 'skills'
			? [ ...( await getSiteFolderSkills( sitePath ) ), ...getBundledSkills() ]
			: getInstructionFiles();
	const file = known.find( ( candidate ) => candidate.id === requestedId );
	if ( ! file ) {
		throw new Error( `Unknown ${ kind } file: ${ requestedId }` );
	}
	return file.id;
}

// Unlike `pathExists`, true for a dangling symlink too: `.claude` links move with their target.
async function exists( filePath: string ): Promise< boolean > {
	try {
		await fs.promises.lstat( filePath );
		return true;
	} catch {
		return false;
	}
}
