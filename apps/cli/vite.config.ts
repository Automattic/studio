import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { rmSync } from 'fs';
import { sync as globSync } from 'glob';

const yargsPath = dirname( require.resolve( 'yargs' ) );
const yargsLocalesPath = join( yargsPath, 'locales' );
const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );
const packageVersion = JSON.parse(
	readFileSync( resolve( __dirname, '..', 'studio', 'package.json' ), 'utf-8' )
).version;

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
		...( existsSync( cliNodeModulesPath )
			? [
					viteStaticCopy( {
						targets: [
							{
								src: 'node_modules',
								dest: '.',
							},
						],
					} ),
					{
						// Remove asyncify PHP-WASM builds from dist. JSPI is a newer and faster technology, and
						// there's no need for us to bundle both build formats. Removing asyncify saves ~250MB.
						name: 'prune-php-wasm-asyncify',
						apply: 'build' as const,
						closeBundle() {
							const asyncifyPaths = globSync( '@php-wasm/node-*/asyncify/', {
								cwd: distCliNodeModulesPath,
								absolute: true,
							} );

							for ( const asyncifyPath of asyncifyPaths ) {
								rmSync( asyncifyPath, { recursive: true, force: true } );
							}
						},
					},
			  ]
			: [] ),
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
			external: [
				/^node:/,
				/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/,
				'fs/promises',
				'dns/promises',
				'pm2',
				// `trash` includes a native macOS binary that Vite/Rollup inlines as a base64 string, which
				// generates an error in the production build
				'trash',
				'@php-wasm/node',
				'@php-wasm/web',
				'@php-wasm/logger',
				'@php-wasm/universal',
				'@php-wasm/scopes',
				'@wp-playground/cli',
				'@wp-playground/blueprints',
				'@wp-playground/wordpress',
			],
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
