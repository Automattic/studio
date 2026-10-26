import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { readSitePaths } from '../sites/site-path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { isErrnoException } from './is-errno-exception';
import { readSharedConfig, updateSharedConfig } from './shared-config';

/**
 * Install the skills selected for every site from a source directory into a site.
 *
 * Source directory layout: each directory is a skill (studio-cli/SKILL.md,
 * wp-plugin-development/SKILL.md, ...), installed to .agents/skills/<id>/SKILL.md
 * and linked from .claude/skills/<id>.
 */
export async function installSelectedSkillsToSite(
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
		if ( entry.isDirectory() && userSelectedGlobalSkills.includes( entry.name ) ) {
			if ( ! ( await isSiteAgentFileDisabled( site.path, entry.name ) ) ) {
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

export async function removeSkillFromSite( sitePath: string, skillId: string ): Promise< void > {
	await removeSiteAgentFile( sitePath, skillId );
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
	await moveSiteAgentFile( site.path, id, true );
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

export interface SiteAgentFile {
	id: string;
	displayName: string;
	description: string;
	// Present on the site, switched on or off.
	installed: boolean;
	// Where agents find it.
	enabled: boolean;
}

// A switched-off file keeps its content, out of the folders agents read.
function getLocations( sitePath: string, id: string ) {
	return [ '.agents', '.claude' ].map( ( owner ) => ( {
		enabled: path.join( sitePath, owner, 'skills', id ),
		disabled: path.join( sitePath, owner, 'disabled-skills', id ),
	} ) );
}

export async function getSiteAgentFiles( sitePath: string ): Promise< SiteAgentFile[] > {
	return Promise.all(
		getBundledSkills().map( async ( file ) => {
			// Skills live in `.agents`; `.claude` only links to them.
			const [ location ] = getLocations( sitePath, file.id );
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
function isSiteAgentFileDisabled( sitePath: string, id: string ) {
	return pathExists( getLocations( sitePath, id )[ 0 ].disabled );
}

// Moves a file between where agents find it and where switched-off files wait.
async function moveSiteAgentFile(
	sitePath: string,
	id: string,
	enabled: boolean
): Promise< boolean > {
	let moved = false;
	for ( const location of getLocations( sitePath, id ) ) {
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
	requestedId: string,
	enabled: boolean
): Promise< void > {
	const id = getKnownFileId( requestedId );
	const moved = await moveSiteAgentFile( sitePath, id, enabled );
	// Switching on a skill the site never had installs it.
	if ( enabled && ! moved ) {
		await installSkillToSite( { path: sitePath }, bundledPath, id, false );
	}
}

export async function removeSiteAgentFile(
	sitePath: string,
	requestedId: string
): Promise< void > {
	const id = getKnownFileId( requestedId );
	for ( const location of getLocations( sitePath, id ) ) {
		await fs.promises.rm( location.enabled, { recursive: true, force: true } );
		await fs.promises.rm( location.disabled, { recursive: true, force: true } );
	}
}

// Paths are built from the catalog's own id, never the requested one.
function getKnownFileId( requestedId: string ): string {
	const file = getBundledSkills().find( ( candidate ) => candidate.id === requestedId );
	if ( ! file ) {
		throw new Error( `Unknown skill: ${ requestedId }` );
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
