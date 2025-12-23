import { writeFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type { Artefact } from './artefact-parser';

/**
 * Get the path to a Studio site's directory
 *
 * @param siteName - Name of the Studio site (e.g., 'mysite')
 * @returns Absolute path to site directory
 */
export function getStudioSitePath( siteName: string ): string {
	// Studio sites are stored in ~/Studio/sites/{siteName}
	return join( homedir(), 'Studio', 'sites', siteName );
}

/**
 * Check if a Studio site exists
 *
 * @param siteName - Name of the Studio site
 * @returns true if site exists
 */
export function studioSiteExists( siteName: string ): boolean {
	const sitePath = getStudioSitePath( siteName );
	return existsSync( join( sitePath, 'wp-config.php' ) );
}

/**
 * List all Studio sites
 *
 * @returns Array of site names
 */
export async function listStudioSites(): Promise< string[] > {
	const studiosPath = join( homedir(), 'Studio', 'sites' );

	if ( ! existsSync( studiosPath ) ) {
		return [];
	}

	try {
		const entries = await readdir( studiosPath, { withFileTypes: true } );
		const sites: string[] = [];

		for ( const entry of entries ) {
			if ( entry.isDirectory() ) {
				const wpConfigPath = join( studiosPath, entry.name, 'wp-config.php' );
				if ( existsSync( wpConfigPath ) ) {
					sites.push( entry.name );
				}
			}
		}

		return sites;
	} catch ( error ) {
		console.warn( 'Failed to list Studio sites:', error );
		return [];
	}
}

/**
 * Install a block artefact to a site's plugins directory by path.
 *
 * Creates the plugin directory and writes all files from the artefact.
 * The block will appear in WordPress plugins but needs to be activated manually.
 *
 * @param sitePath - Full path to the WordPress site directory
 * @param artefact - Parsed artefact containing block files
 * @throws Error if site doesn't exist or installation fails
 */
export async function installBlockToSitePath(
	sitePath: string,
	artefact: Artefact
): Promise< void > {
	// Verify site exists
	const wpConfigPath = join( sitePath, 'wp-config.php' );
	if ( ! existsSync( wpConfigPath ) ) {
		throw new Error(
			`WordPress installation not found at '${ sitePath }'. Missing wp-config.php.`
		);
	}

	// Plugin will be installed to wp-content/plugins/{slug}
	const pluginPath = join( sitePath, 'wp-content', 'plugins', artefact.slug );

	// Create plugin directory
	await mkdir( pluginPath, { recursive: true } );

	// Write all files from artefact
	let filesWritten = 0;
	for ( const file of artefact.files ) {
		const filePath = join( pluginPath, file.path );
		const fileDir = dirname( filePath );

		// Ensure directory exists
		await mkdir( fileDir, { recursive: true } );

		// Write file
		await writeFile( filePath, file.content, 'utf-8' );
		filesWritten++;
	}

	if ( filesWritten === 0 ) {
		throw new Error( 'No files were written - artefact may be empty' );
	}
}

/**
 * Install a block artefact to a Studio site's plugins directory by name.
 *
 * This is a convenience wrapper around installBlockToSitePath() for sites
 * in the default Studio location (~/Studio/sites/).
 *
 * @param siteName - Name of the Studio site (e.g., 'mysite')
 * @param artefact - Parsed artefact containing block files
 * @throws Error if site doesn't exist or installation fails
 */
export async function installBlockToSite(
	siteName: string,
	artefact: Artefact
): Promise< void > {
	const sitePath = getStudioSitePath( siteName );

	// Verify site exists
	if ( ! studioSiteExists( siteName ) ) {
		throw new Error(
			`Studio site '${ siteName }' not found. Run 'studio site list' to see available sites.`
		);
	}

	return installBlockToSitePath( sitePath, artefact );
}

/**
 * Get the WordPress plugin activation URL for a block
 *
 * @param siteName - Name of the Studio site
 * @param pluginSlug - Plugin slug (e.g., 'my-block')
 * @returns URL to WordPress plugins page
 */
export function getPluginActivationUrl( siteName: string, pluginSlug: string ): string {
	// Studio sites typically use {siteName}.local domain
	return `http://${ siteName }.local/wp-admin/plugins.php`;
}

/**
 * Install options for blocks
 */
export interface InstallOptions {
	/** Overwrite existing plugin if it exists (default: false) */
	overwrite?: boolean;
	/** Verbose output (default: false) */
	verbose?: boolean;
}

/**
 * Install a block with options
 *
 * @param siteName - Name of the Studio site
 * @param artefact - Parsed artefact
 * @param options - Install options
 */
export async function installBlock(
	siteName: string,
	artefact: Artefact,
	options: InstallOptions = {}
): Promise< void > {
	const sitePath = getStudioSitePath( siteName );
	const pluginPath = join( sitePath, 'wp-content', 'plugins', artefact.slug );

	// Check if plugin already exists
	if ( existsSync( pluginPath ) && ! options.overwrite ) {
		throw new Error(
			`Plugin '${ artefact.slug }' already exists. Use --overwrite to replace it.`
		);
	}

	// Install the block
	await installBlockToSite( siteName, artefact );

	if ( options.verbose ) {
		console.log( `Installed ${ artefact.files.length } files to ${ pluginPath }` );
	}
}
