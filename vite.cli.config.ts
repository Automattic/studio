import { resolve } from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { existsSync, rmSync } from 'fs';
import { sync as globSync } from 'glob';

const yargsLocalesPath = resolve( __dirname, 'node_modules/yargs/locales' );
const cliNodeModulesPath = resolve( __dirname, 'cli/node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );

export default defineConfig( {
	plugins: [
		...( existsSync( yargsLocalesPath )
			? [
					viteStaticCopy( {
						targets: [
							{
								src: 'node_modules/yargs/locales/*',
								dest: '../locales',
							},
						],
					} ),
			  ]
			: [] ),
		...( existsSync( cliNodeModulesPath )
			? [
					viteStaticCopy( {
						targets: [
							{
								src: 'cli/node_modules',
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
				main: resolve( __dirname, 'cli/index.ts' ),
				'proxy-daemon': resolve( __dirname, 'cli/proxy-daemon.ts' ),
				'wordpress-server-child': resolve( __dirname, 'cli/wordpress-server-child.ts' ),
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
			cli: resolve( __dirname, 'cli' ),
			src: resolve( __dirname, 'src' ),
			vendor: resolve( __dirname, 'vendor' ),
			common: resolve( __dirname, 'common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
} );
