import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { globSync } from 'glob';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );

// Only copy native/WASM packages to dist (pure JS deps are inlined by Vite)
// Only copy packages that can't be bundled or must stay externalized.
const nativeModulePaths = [
	{ src: 'node_modules/@php-wasm', dest: 'node_modules' },
	{ src: 'node_modules/@wp-playground', dest: 'node_modules' },
	{ src: 'node_modules/@anthropic-ai', dest: 'node_modules' },
	{ src: 'node_modules/@img', dest: 'node_modules' },
	{ src: 'node_modules/@silvia-odwyer/photon-node', dest: 'node_modules/@silvia-odwyer' },
	{ src: 'node_modules/fs-ext-extra-prebuilt', dest: 'node_modules' },
	{ src: 'node_modules/koffi', dest: 'node_modules' },
	{ src: 'node_modules/sharp', dest: 'node_modules' },
	{ src: 'node_modules/playwright', dest: 'node_modules' },
	{ src: 'node_modules/playwright-core', dest: 'node_modules' },
	{ src: 'node_modules/zod', dest: 'node_modules' },
];

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			...( existsSync( cliNodeModulesPath )
				? [
						viteStaticCopy( {
							targets: nativeModulePaths.filter( ( { src } ) =>
								existsSync( resolve( __dirname, src ) )
							),
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
				output: {
					// Single-file bundle so the SEA can embed one self-contained main.mjs
					// without a chunk-name scavenger hunt at runtime. Requires a single
					// entry — ok for prod since there's only `main`.
					inlineDynamicImports: true,
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
