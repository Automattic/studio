/**
 * The code a site runs: its active plugins and themes, read from the options
 * WordPress loads them by (active_plugins, template and stylesheet), and the
 * files in their folders, as one version a check compares to see whether that
 * code changed. Dependencies a build installs (node_modules) are not the
 * site's code and are not read.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';

/** A file's version as a check compares it: its modification time and size. */
export const fileStamp = ( { mtimeMs, size }: { mtimeMs: number; size: number } ) =>
	`${ mtimeMs }:${ size }`;

/**
 * The files under a folder whose names `wanted` keeps, in the order
 * readdir( dir, { recursive: true } ) lists them, leaving out dependencies a
 * build installs (node_modules). A folder it cannot read has no files.
 */
export async function filesUnder(
	dir: string,
	wanted: ( name: string ) => boolean
): Promise< string[] > {
	const found: string[] = [];
	const folders = [ dir ];
	for ( let folder = folders.pop(); folder !== undefined; folder = folders.pop() ) {
		const entries = await readdir( folder, { withFileTypes: true } ).catch( () => [] );
		for ( const entry of entries ) {
			const at = path.join( folder, entry.name );
			if ( entry.isDirectory() ) {
				if ( entry.name !== 'node_modules' ) {
					folders.push( at );
				}
			} else if ( entry.isFile() && wanted( entry.name ) ) {
				found.push( at );
			}
		}
	}
	return found;
}

// Each active plugin and theme, by `plugin <file>` (as active_plugins names
// it) and `theme <slug>`, and each file in it as `[ name, path:mtime:size ]`,
// its path from the plugin's or theme's folder. A plugin in a folder is the
// folder; a single-file plugin is its file, its path from wp-content, and
// has no name to leave it out by.
type Code = Record< string, Array< [ string | undefined, string ] > >;

// The reads of a site's code under way, by its folder: the sources of a
// snapshot read it side by side (site-changes.ts), each for its own files.
const reading = new Map< string, Promise< Code > >();

function readCode( sitePath: string ): Promise< Code > {
	const key = path.resolve( sitePath );
	let code = reading.get( key );
	if ( ! code ) {
		code = walkCode( sitePath ).finally( () => reading.delete( key ) );
		reading.set( key, code );
	}
	return code;
}

async function walkCode( sitePath: string ): Promise< Code > {
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
	const stamped = async ( files: string[], from: string, named = true ) =>
		Promise.all(
			files.map(
				async ( file ): Promise< [ string | undefined, string ] > => [
					named ? path.basename( file ) : undefined,
					`${ path.relative( from, file ) }:${ fileStamp(
						await stat( file ).catch( () => ( { mtimeMs: 0, size: -1 } ) )
					) }`,
				]
			)
		);
	const dirFiles = async ( dir: string ) => stamped( await filesUnder( dir, () => true ), dir );
	const plugins = active.plugins.map( async ( plugin ) => [
		`plugin ${ plugin }`,
		plugin.includes( '/' )
			? await dirFiles( path.join( content, 'plugins', path.dirname( plugin ) ) )
			: await stamped( [ path.join( content, 'plugins', plugin ) ], content, false ),
	] );
	const themes = active.themes.map( async ( theme ) => [
		`theme ${ theme }`,
		await dirFiles( path.join( content, 'themes', theme ) ),
	] );
	return Object.fromEntries( await Promise.all( [ ...plugins, ...themes ] ) );
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
	const code = await readCode( sitePath );
	return Object.fromEntries(
		Object.entries( code ).map( ( [ key, files ] ) => [
			key,
			files
				.filter( ( [ name ] ) => name === undefined || wanted( name ) )
				.map( ( [ , version ] ) => version )
				.sort()
				.join( '|' ),
		] )
	);
}

/** The site's active plugins and themes, and the files in them `wanted` keeps, as one version. */
export async function activeCodeVersion(
	sitePath: string,
	wanted: ( name: string ) => boolean
): Promise< string > {
	return JSON.stringify( await activeCode( sitePath, wanted ) );
}
