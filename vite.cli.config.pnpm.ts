/**
 * Vite CLI config with pnpm support
 * 
 * This is a modified version of vite.cli.config.ts that uses a custom plugin
 * to handle pnpm's symlinked node_modules structure.
 * 
 * To test:
 *   npx vite build --config vite.cli.config.pnpm.ts
 */

import { resolve } from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { existsSync } from 'fs';
import { copyCliDeps } from './scripts/vite-plugin-copy-cli-deps';

const yargsLocalesPath = resolve( __dirname, 'node_modules/yargs/locales' );
const cliNodeModulesPath = resolve( __dirname, 'cli/node_modules' );

export default defineConfig( {
	plugins: [
		// Copy yargs locales (unchanged)
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
		
		// Use custom plugin for CLI node_modules (pnpm-compatible)
		...( existsSync( cliNodeModulesPath )
			? [ copyCliDeps( {
					source: 'cli/node_modules',
					dest: 'node_modules',
			  } ) ]
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
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
} );
