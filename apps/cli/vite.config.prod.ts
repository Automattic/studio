import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { globSync } from 'glob';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );
const dlaPath = resolve( __dirname, 'ai/dla' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			// Copy the SDK plugin tree into `dist/cli/plugin/` so the Electron-bundled
			// `studio code` can load it at runtime. This mirrors the equivalent block
			// in `vite.config.dev.ts` and `vite.config.npm.ts` and fixes a pre-existing
			// gap where the prod config was missing the target. Tracked independently
			// of the DLA integration work it landed alongside; reviewable on its own.
			viteStaticCopy( {
				targets: [
					{
						src: 'ai/plugin',
						dest: '.',
					},
					// Conditionally include the vendored Data Liberation Agent tree.
					// `ai/dla` is fetched at install time via `scripts/download-data-liberation-agent.ts`
					// and may be absent for contributors without access to the private repo;
					// guard with `existsSync` so the build still succeeds in that case
					// (mirrors the `existsSync(cliNodeModulesPath)` pattern below).
					...( existsSync( dlaPath )
						? [
								{
									src: 'ai/dla',
									dest: '.',
								},
						  ]
						: [] ),
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
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
