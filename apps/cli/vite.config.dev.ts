import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { sync as globSync } from 'glob';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig, nodeBuiltinExternals } from './vite.config.base';

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
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
							// Remove PHP-WASM asyncify binaries from dist. JSPI is newer and faster
							// than asyncify, and there's no need to bundle both. Removing asyncify
							// saves ~250MB. Web binaries were removed upstream in
							// WordPress/wordpress-playground#3315.
							name: 'prune-php-wasm',
							apply: 'build' as const,
							closeBundle() {
								const asyncifyPaths = globSync( '@php-wasm/node-*/asyncify/', {
									cwd: distCliNodeModulesPath,
									absolute: true,
								} );

								for ( const path of asyncifyPaths ) {
									rmSync( path, { recursive: true, force: true } );
								}
							},
						},
				  ]
				: [] ),
		],
		build: {
			rollupOptions: {
				external: [
					...nodeBuiltinExternals,
					// `trash` includes a native macOS binary that Vite/Rollup inlines as a base64 string, which
					// generates an error in the production build
					'trash',
					// Fundamentally, yargs works well with Vite/Rollup bundling. The only issue is that it uses
					// __filename-based lookups for JSON translation files, which breaks when bundling. This is a
					// pragmatic solution to that problem.
					'yargs',
					'@php-wasm/node',
					'@php-wasm/web',
					'@php-wasm/logger',
					'@php-wasm/universal',
					'@php-wasm/scopes',
					'@wp-playground/cli',
					'@wp-playground/blueprints',
					'@wp-playground/wordpress',
					'@anthropic-ai/claude-agent-sdk',
					'koffi',
					'playwright',
					'playwright-core',
				],
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
		},
	} )
);
