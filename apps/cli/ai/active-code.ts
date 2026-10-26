/**
 * The code a site runs: its active plugins and themes, read from the options
 * WordPress loads them by (active_plugins, template and stylesheet), and the
 * files in their folders, as one version a check compares to see whether that
 * code changed. Dependencies a build installs (node_modules) are not the
 * site's code and are not read.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from 'cli/ai/site-database';

// A file as its path, modification time and size.
async function version( file: string, from: string ): Promise< string > {
	const { mtimeMs, size } = await stat( file ).catch( () => ( { mtimeMs: 0, size: -1 } ) );
	return `${ path.relative( from, file ) }:${ mtimeMs }:${ size }`;
}

async function files( dir: string, wanted: ( name: string ) => boolean ): Promise< string[] > {
	const entries = await readdir( dir, { withFileTypes: true } ).catch( () => [] );
	const found = await Promise.all(
		entries.map( ( entry ) => {
			const at = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				return entry.name === 'node_modules' ? [] : files( at, wanted );
			}
			return entry.isFile() && wanted( entry.name ) ? [ at ] : [];
		} )
	);
	return found.flat();
}

/**
 * The version of each of the site's active plugins and themes, by
 * `plugin <file>` (as active_plugins names it) and `theme <slug>`, from the
 * files in them `wanted` keeps.
 */
export async function activeCode(
	sitePath: string,
	wanted: ( name: string ) => boolean
): Promise< Record< string, string > > {
	const content = path.join( sitePath, 'wp-content' );
	const active = await readWordPressSite( sitePath, ( site ) => {
		const plugins = site.option( 'active_plugins' );
		return {
			plugins: plugins && typeof plugins === 'object' ? Object.values( plugins ).map( String ) : [],
			themes: [ ...new Set( [ site.option( 'template' ), site.option( 'stylesheet' ) ] ) ].filter(
				( theme ): theme is string => typeof theme === 'string' && theme !== ''
			),
		};
	} );
	// A plugin in a folder is the folder; a single-file plugin is its file.
	const dirVersion = async ( dir: string ) =>
		( await Promise.all( ( await files( dir, wanted ) ).map( ( file ) => version( file, dir ) ) ) )
			.sort()
			.join( '|' );
	const plugins = active.plugins.map( async ( plugin ) => [
		`plugin ${ plugin }`,
		plugin.includes( '/' )
			? await dirVersion( path.join( content, 'plugins', path.dirname( plugin ) ) )
			: await version( path.join( content, 'plugins', plugin ), content ),
	] );
	const themes = active.themes.map( async ( theme ) => [
		`theme ${ theme }`,
		await dirVersion( path.join( content, 'themes', theme ) ),
	] );
	return Object.fromEntries( await Promise.all( [ ...plugins, ...themes ] ) );
}

/** The site's active plugins and themes, and the files in them `wanted` keeps, as one version. */
export async function activeCodeVersion(
	sitePath: string,
	wanted: ( name: string ) => boolean
): Promise< string > {
	return JSON.stringify( await activeCode( sitePath, wanted ) );
}
