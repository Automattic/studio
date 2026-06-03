import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { Plugin } from 'esbuild';

/**
 * In-process compiler for JSX/React Gutenberg blocks.
 *
 * Studio generates blocks as JSX `src/` (editor authored with `@wordpress/*`,
 * front-end `view.js` plain DOM) and compiles them here to `build/` with the
 * WordPress packages externalised to their `wp.*` runtime globals — the same
 * output shape `@wordpress/scripts` produces, but with esbuild in-process: no
 * `npm install`, no webpack, no subprocess. Developers can hand-edit `src/`
 * and recompile.
 */

/**
 * Map a bare import to the WordPress runtime global it resolves to and the
 * script handle WordPress must enqueue as a dependency. Returns null for
 * relative/unknown imports (esbuild bundles those normally).
 */
export function wpGlobalForImport( importPath: string ): { global: string; handle: string } | null {
	if ( importPath === 'react/jsx-runtime' || importPath === 'react/jsx-dev-runtime' ) {
		return { global: 'window.ReactJSXRuntime', handle: 'react-jsx-runtime' };
	}
	if ( importPath === 'react' ) {
		return { global: 'window.React', handle: 'react' };
	}
	if ( importPath === 'react-dom' ) {
		return { global: 'window.ReactDOM', handle: 'react-dom' };
	}
	const match = importPath.match( /^@wordpress\/([a-z0-9-]+)$/ );
	if ( match ) {
		const pkg = match[ 1 ];
		const camel = pkg.replace( /-([a-z])/g, ( _all, ch: string ) => ch.toUpperCase() );
		return { global: `window.wp.${ camel }`, handle: `wp-${ pkg }` };
	}
	return null;
}

/** Render a WordPress `*.asset.php` dependency manifest (deduped, sorted). */
export function assetPhp( handles: string[], version: string ): string {
	const deps = Array.from( new Set( handles ) ).sort();
	const list = deps.map( ( handle ) => `'${ handle }'` ).join( ', ' );
	const inner = deps.length ? `array( ${ list } )` : 'array()';
	return `<?php return array( 'dependencies' => ${ inner }, 'version' => '${ version }' );\n`;
}

function wpExternalsPlugin( collected: Set< string > ): Plugin {
	return {
		name: 'wp-externals',
		setup( pluginBuild ) {
			pluginBuild.onResolve( { filter: /^(@wordpress\/|react($|\/)|react-dom$)/ }, ( args ) => {
				const mapped = wpGlobalForImport( args.path );
				if ( ! mapped ) {
					return null;
				}
				collected.add( mapped.handle );
				return { path: args.path, namespace: 'wp-global' };
			} );
			pluginBuild.onLoad( { filter: /.*/, namespace: 'wp-global' }, ( args ) => {
				const mapped = wpGlobalForImport( args.path );
				return { contents: `module.exports = ${ mapped?.global ?? 'undefined' };`, loader: 'js' };
			} );
		},
	};
}

async function bundleEntry( entry: string, outfile: string ): Promise< string[] > {
	// Loaded lazily: esbuild runs an invariant check at import time that fails
	// under jsdom (vitest's default env), so importing this module — and the
	// tools that use it — must not pull esbuild in until a block is compiled.
	const { build } = await import( 'esbuild' );
	const collected = new Set< string >();
	await build( {
		entryPoints: [ entry ],
		outfile,
		bundle: true,
		format: 'iife',
		target: 'es2018',
		// WordPress blocks author JSX in .js files (wp-scripts convention).
		loader: { '.js': 'jsx' },
		jsx: 'automatic',
		jsxImportSource: 'react',
		minify: true,
		legalComments: 'none',
		logLevel: 'silent',
		plugins: [ wpExternalsPlugin( collected ) ],
	} );
	return Array.from( collected );
}

function contentHash( file: string ): string {
	return createHash( 'sha1' ).update( readFileSync( file ) ).digest( 'hex' ).slice( 0, 20 );
}

/**
 * Compile a block's `src/` to `outDir` (its `build/`): bundle `index.js` (the
 * editor) and, if present, `view.js` (the front end), emitting each with a
 * matching `*.asset.php`, and copy `block.json` + `render.php` through (their
 * `file:./` references now resolve to the built siblings).
 */
export async function compileBlock(
	srcDir: string,
	outDir: string
): Promise< { editorHandles: string[]; viewHandles: string[] } > {
	mkdirSync( outDir, { recursive: true } );

	const editorOut = path.join( outDir, 'index.js' );
	const editorHandles = await bundleEntry( path.join( srcDir, 'index.js' ), editorOut );
	writeFileSync(
		path.join( outDir, 'index.asset.php' ),
		assetPhp( editorHandles, contentHash( editorOut ) )
	);

	let viewHandles: string[] = [];
	const viewEntry = path.join( srcDir, 'view.js' );
	if ( existsSync( viewEntry ) ) {
		const viewOut = path.join( outDir, 'view.js' );
		viewHandles = await bundleEntry( viewEntry, viewOut );
		writeFileSync(
			path.join( outDir, 'view.asset.php' ),
			assetPhp( viewHandles, contentHash( viewOut ) )
		);
	}

	for ( const file of [ 'block.json', 'render.php' ] ) {
		const from = path.join( srcDir, file );
		if ( existsSync( from ) ) {
			copyFileSync( from, path.join( outDir, file ) );
		}
	}

	return { editorHandles, viewHandles };
}
