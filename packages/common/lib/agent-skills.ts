import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { readSitePaths } from '../sites/site-path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { isErrnoException } from './is-errno-exception';
import { readSharedConfig, updateSharedConfig } from './shared-config';

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
	const selectedSkills = ( await readSharedConfig() ).selectedSkills ?? [];
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
	const selectedSkills = ( await readSharedConfig() ).selectedSkills ?? [];
	await updateSharedConfig( {
		selectedSkills: Array.from( new Set( [ ...selectedSkills, skillId ] ) ),
	} );
}

export async function removeSkillFromAllSites( skillId: string ): Promise< void > {
	await forEachSite( ( sitePath ) => removeSkillFromSite( sitePath, skillId ) );
	const selectedSkills = ( await readSharedConfig() ).selectedSkills ?? [];
	await updateSharedConfig( { selectedSkills: selectedSkills.filter( ( id ) => id !== skillId ) } );
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
	description: string;
	// Present on the site, switched on or off.
	installed: boolean;
	// Where agents find it.
	enabled: boolean;
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

function getCatalog( kind: SiteAgentFileKind ) {
	return kind === 'skills' ? getBundledSkills() : getInstructionFiles();
}

export async function getSiteAgentFiles(
	sitePath: string,
	kind: SiteAgentFileKind
): Promise< SiteAgentFile[] > {
	return Promise.all(
		getCatalog( kind ).map( async ( file ) => {
			// Skills live in `.agents`; `.claude` only links to them.
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
	const id = getKnownFileId( kind, requestedId );
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
	const id = getKnownFileId( kind, requestedId );
	for ( const location of getLocations( sitePath, kind, id ) ) {
		await fs.promises.rm( location.enabled, { recursive: true, force: true } );
		await fs.promises.rm( location.disabled, { recursive: true, force: true } );
	}
}

// Paths are built from the catalog's own id, never the requested one.
function getKnownFileId( kind: SiteAgentFileKind, requestedId: string ): string {
	const file = getCatalog( kind ).find( ( candidate ) => candidate.id === requestedId );
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
