import fs from 'fs/promises';
import nodePath from 'path';

/**
 * Scaffolds a structured WordPress plugin into a site's wp-content/plugins
 * directory: main file with the full plugin header, a readme.txt skeleton,
 * an uninstall.php guard, and an includes/ directory. Only "Plugin Name" is
 * required by WordPress; the rest of the header comes from the create form,
 * with sensible scaffold defaults for the compatibility fields.
 */

export interface PluginScaffoldMeta {
	slug: string;
	name: string;
	description?: string;
	author?: string;
	version?: string;
	pluginUri?: string;
	authorUri?: string;
	license?: string;
}

export interface PluginScaffoldFile {
	relativePath: string;
	contents: string;
}

// Scaffold defaults for the compatibility fields the form deliberately
// doesn't ask about.
const REQUIRES_AT_LEAST = '6.0';
const REQUIRES_PHP = '7.4';

function sanitizeHeaderValue( value: string ): string {
	// Header values live inside a PHP comment block; strip anything that
	// could terminate it or smuggle in PHP.
	return value.replace( /\*\//g, '' ).replace( /<\?/g, '' ).trim();
}

function toConstantPrefix( slug: string ): string {
	const constant = slug.toUpperCase().replace( /[^A-Z0-9]+/g, '_' );
	// Constants can't start with a digit.
	return /^[0-9]/.test( constant ) ? `PLUGIN_${ constant }` : constant;
}

function buildMainFile( meta: PluginScaffoldMeta ): string {
	const headerLines: [ string, string | undefined ][] = [
		[ 'Plugin Name', meta.name ],
		[ 'Plugin URI', meta.pluginUri ],
		[ 'Description', meta.description ],
		[ 'Version', meta.version ],
		[ 'Requires at least', REQUIRES_AT_LEAST ],
		[ 'Requires PHP', REQUIRES_PHP ],
		[ 'Author', meta.author ],
		[ 'Author URI', meta.authorUri ],
		[ 'License', meta.license ],
		[ 'Text Domain', meta.slug ],
	];
	const header = headerLines
		.filter( ( [ , value ] ) => Boolean( value?.trim() ) )
		.map( ( [ label, value ] ) => ` * ${ label }: ${ sanitizeHeaderValue( value! ) }` )
		.join( '\n' );

	const constantPrefix = toConstantPrefix( meta.slug );
	const version = sanitizeHeaderValue( meta.version || '0.1.0' );

	return `<?php
/**
${ header }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

define( '${ constantPrefix }_VERSION', '${ version }' );

// Your plugin code starts here.
`;
}

function buildReadme( meta: PluginScaffoldMeta ): string {
	const description = sanitizeHeaderValue( meta.description || meta.name );
	const lines = [
		`=== ${ sanitizeHeaderValue( meta.name ) } ===`,
		...( meta.author?.trim() ? [ `Contributors: ${ sanitizeHeaderValue( meta.author ) }` ] : [] ),
		`Requires at least: ${ REQUIRES_AT_LEAST }`,
		`Requires PHP: ${ REQUIRES_PHP }`,
		`Stable tag: ${ sanitizeHeaderValue( meta.version || '0.1.0' ) }`,
		...( meta.license?.trim() ? [ `License: ${ sanitizeHeaderValue( meta.license ) }` ] : [] ),
		'',
		description,
		'',
		'== Description ==',
		'',
		description,
		'',
	];
	return lines.join( '\n' );
}

const UNINSTALL_FILE = `<?php
// Runs when the plugin is deleted from the Plugins screen.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
`;

const SILENCE = `<?php
// Silence is golden.
`;

export function buildPluginFiles( meta: PluginScaffoldMeta ): PluginScaffoldFile[] {
	return [
		{ relativePath: `${ meta.slug }.php`, contents: buildMainFile( meta ) },
		{ relativePath: 'readme.txt', contents: buildReadme( meta ) },
		{ relativePath: 'uninstall.php', contents: UNINSTALL_FILE },
		{ relativePath: nodePath.join( 'includes', 'index.php' ), contents: SILENCE },
	];
}

/**
 * Writes the scaffold into `<sitePath>/wp-content/plugins/<slug>/`.
 * Fails if the plugin directory already exists so an existing plugin can
 * never be clobbered.
 */
export async function scaffoldPluginInSite(
	sitePath: string,
	meta: PluginScaffoldMeta
): Promise< string > {
	if ( ! meta.slug || ! /^[a-z0-9-]+$/.test( meta.slug ) ) {
		throw new Error( `Invalid plugin slug: ${ meta.slug }` );
	}
	if ( ! meta.name?.trim() ) {
		throw new Error( 'Plugin name is required.' );
	}
	const pluginDir = nodePath.join( sitePath, 'wp-content', 'plugins', meta.slug );
	let pluginDirExists = true;
	try {
		await fs.stat( pluginDir );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
			throw error;
		}
		pluginDirExists = false;
	}
	if ( pluginDirExists ) {
		throw new Error( `A plugin folder named "${ meta.slug }" already exists on this site.` );
	}

	await fs.mkdir( nodePath.join( pluginDir, 'includes' ), { recursive: true } );
	for ( const file of buildPluginFiles( meta ) ) {
		await fs.writeFile( nodePath.join( pluginDir, file.relativePath ), file.contents, 'utf8' );
	}
	return pluginDir;
}
