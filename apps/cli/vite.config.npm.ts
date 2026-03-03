import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const yargsPath = dirname( require.resolve( 'yargs' ) );
const yargsLocalesPath = join( yargsPath, 'locales' );

const packageJson = JSON.parse( readFileSync( resolve( __dirname, 'package.json' ), 'utf-8' ) );
const packageVersion = packageJson.version;

// Externalize all runtime dependencies except @studio/common (which is bundled via alias)
const externalDeps = Object.keys( packageJson.dependencies || {} ).filter(
	( dep ) => dep !== '@studio/common'
);

/**
 * Vite plugin that prepends a Node.js shebang to the main entry point.
 * Only main.js gets the shebang — proxy-daemon and wordpress-server-child
 * are spawned by PM2 with an explicit `node` invocation.
 */
function shebangPlugin(): Plugin {
	return {
		name: 'shebang',
		apply: 'build',
		generateBundle( _options, bundle ) {
			const mainChunk = bundle[ 'main.js' ];
			if ( mainChunk && mainChunk.type === 'chunk' ) {
				mainChunk.code = '#!/usr/bin/env node\n' + mainChunk.code;
			}
		},
	};
}

export default defineConfig( {
	plugins: [
		viteStaticCopy( {
			targets: [
				{
					src: normalizePath( join( yargsLocalesPath, '*' ) ),
					dest: '../locales',
				},
			],
		} ),
		shebangPlugin(),
	],
	build: {
		lib: {
			entry: {
				main: resolve( __dirname, 'index.ts' ),
				'proxy-daemon': resolve( __dirname, 'proxy-daemon.ts' ),
				'wordpress-server-child': resolve( __dirname, 'wordpress-server-child.ts' ),
			},
			name: 'StudioCLI',
			formats: [ 'cjs' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rollupOptions: {
			external: ( id ) => {
				// Node built-ins
				if ( /^node:/.test( id ) ) {
					return true;
				}
				if (
					/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/.test(
						id
					)
				) {
					return true;
				}
				if ( id === 'fs/promises' || id === 'dns/promises' ) {
					return true;
				}

				// Bundle the blueprint-schema-validator subpath (not exported by the package)
				if ( id.includes( 'blueprint-schema-validator' ) ) {
					return false;
				}

				// Externalize @php-wasm/* and @wp-playground/* (transitive deps resolved by npm)
				if ( /^@php-wasm\//.test( id ) || /^@wp-playground\//.test( id ) ) {
					return true;
				}

				// Externalize all declared runtime dependencies
				return externalDeps.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
			},
			output: {
				format: 'cjs',
				entryFileNames: '[name].js',
			},
		},
		commonjsOptions: {
			ignoreDynamicRequires: true,
		},
		sourcemap: true,
		minify: false,
	},
	resolve: {
		alias: {
			cli: resolve( __dirname, '.' ),
			'@studio/common': resolve( __dirname, '../../tools/common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
	define: {
		__STUDIO_CLI_VERSION__: JSON.stringify( packageVersion ),
	},
} );
