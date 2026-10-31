/**
 * The asset files of block editor scripts written without a build. WordPress
 * registers a block.json "editorScript" named as a file, "file:./index.js",
 * with the dependencies of the index.asset.php beside it, and with none when
 * there is none (register_block_script_handle() in wp-includes/blocks.php).
 * A script that reads WordPress's packages from the `wp` global, as one
 * written without a build does, then can run before them and throw, and the
 * block is not registered in the editor.
 *
 * When such a script of an active plugin or theme has no asset file, Studio
 * writes the one @wordpress/scripts would, naming the packages the script
 * reads by their handles (`wp.blockEditor` is "wp-block-editor",
 * wp_default_packages_scripts() in wp-includes/script-loader.php), and says
 * so. Its version is the script's modification time, so a browser loads the
 * script again once it is edited. WordPress leaves out a script whose dependency it has not registered
 * (WP_Dependencies::all_deps()), so only the packages the site's WordPress
 * has are named. A script that imports modules is left to its build.
 */
import { access, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { activeCode } from '@studio/agent/node/active-code';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const KEY = 'block script assets';

const wanted = ( name: string ) =>
	name === 'block.json' || name.endsWith( '.js' ) || name.endsWith( '.asset.php' );

const read = ( sitePath: string ) => activeCode( sitePath, wanted );

// The folder of an active plugin or theme, by the key activeCode() gives it.
function folder( sitePath: string, key: string ): string | undefined {
	const [ kind, name ] = key.split( ' ' );
	if ( kind === 'theme' ) {
		return path.join( sitePath, 'wp-content/themes', name );
	}
	return name.includes( '/' )
		? path.join( sitePath, 'wp-content/plugins', path.dirname( name ) )
		: undefined;
}

/**
 * The handles of the packages of the site's WordPress a script reads from the
 * `wp` global. WordPress registers each wp-includes/js/dist/<name>.js as
 * "wp-<name>", and leaves out a script whose dependency is not registered.
 */
async function packagesRead( sitePath: string, js: string ): Promise< string[] > {
	const names = [ ...js.matchAll( /\bwp\.([a-z][A-Za-z]*)\b/g ) ].map( ( [ , name ] ) =>
		name.replace( /[A-Z]/g, ( letter ) => `-${ letter.toLowerCase() }` )
	);
	const dist = path.join( sitePath, 'wp-includes/js/dist' );
	const found = await Promise.all(
		[ ...new Set( names ) ].map( ( name ) =>
			access( path.join( dist, `${ name }.js` ) ).then(
				() => `wp-${ name }`,
				() => undefined
			)
		)
	);
	return found.filter( ( handle ): handle is string => !! handle ).sort();
}

const IMPORTS = /^\s*import\s|\brequire\s*\(/m;

/** The editor scripts named as files by the block.json files in `dir` that have no asset file. */
async function scriptsWithoutAsset( dir: string, files: string[] ): Promise< string[] > {
	const present = new Set( files );
	const scripts: string[] = [];
	for ( const file of files.filter( ( name ) => path.basename( name ) === 'block.json' ) ) {
		const metadata = JSON.parse(
			await readFile( path.join( dir, file ), 'utf8' ).catch( () => '{}' )
		) as { editorScript?: unknown };
		for ( const script of [ metadata.editorScript ].flat() ) {
			if ( typeof script !== 'string' || ! /^file:.*\.js$/.test( script ) ) {
				continue;
			}
			const js = path.normalize( path.join( path.dirname( file ), script.slice( 5 ) ) );
			if ( present.has( js ) && ! present.has( js.replace( /\.js$/, '.asset.php' ) ) ) {
				scripts.push( path.join( dir, js ) );
			}
		}
	}
	return scripts;
}

export const blockScriptAssets: SiteChangeSource = {
	name: KEY,
	saves: true,
	read: ( sitePath ) => read( sitePath ),
	async check( site, before, after ) {
		const written: string[] = [];
		for ( const [ key, version ] of Object.entries( after ) ) {
			const dir = folder( site.path, key );
			if ( version === before[ key ] || ! dir ) {
				continue;
			}
			// activeCode() versions each file as `path:mtime:size`.
			const files = version
				.split( '|' )
				.filter( Boolean )
				.map( ( entry ) => entry.split( ':' ).slice( 0, -2 ).join( ':' ) );
			for ( const script of await scriptsWithoutAsset( dir, files ) ) {
				const js = await readFile( script, 'utf8' ).catch( () => '' );
				const handles = IMPORTS.test( js ) ? [] : await packagesRead( site.path, js );
				if ( ! handles.length ) {
					continue;
				}
				const asset = script.replace( /\.js$/, '.asset.php' );
				await writeFile(
					asset,
					`<?php return array( 'dependencies' => array( ${ handles
						.map( ( handle ) => `'${ handle }'` )
						.join( ', ' ) } ), 'version' => (string) filemtime( __DIR__ . '/${ path
						.basename( script )
						.replace( /[\\']/g, '\\$&' ) }' ) );\n`
				);
				written.push( `${ asset } (${ handles.join( ', ' ) })` );
			}
		}
		if ( ! written.length ) {
			return { reports: [] };
		}
		return {
			reports: [
				{
					key: KEY,
					summary: `${
						site.name
					}: WordPress registers a block.json "editorScript" named as a file with the dependencies of the .asset.php beside it, and with none when there is none (register_block_script_handle() in wp-includes/blocks.php), so a script that reads WordPress's packages from \`wp\` can run before them. Studio wrote the asset file @wordpress/scripts would, with the packages the script reads (handles as wp_default_packages_scripts() in wp-includes/script-loader.php registers them): ${ written.join(
						'; '
					) }.`,
				},
			],
			next: await read( site.path ),
		};
	},
};
