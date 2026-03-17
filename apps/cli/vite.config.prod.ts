import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { globSync } from 'glob';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import devConfig from './vite.config.dev';

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distCliNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );

export default mergeConfig(
	devConfig,
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
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
