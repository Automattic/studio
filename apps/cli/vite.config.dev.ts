import { existsSync, symlinkSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );
const distNodeModulesPath = resolve( __dirname, 'dist/cli/node_modules' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			viteStaticCopy( {
				targets: [
					{
						src: 'ai/plugin',
						dest: '.',
					},
				],
			} ),
			{
				// Symlink node_modules for dev builds so native modules are accessible
				// without copying hundreds of MB on every rebuild.
				name: 'symlink-node-modules',
				apply: 'build' as const,
				closeBundle() {
					if ( ! existsSync( cliNodeModulesPath ) ) {
						return;
					}
					try {
						unlinkSync( distNodeModulesPath );
					} catch {
						// ignore if doesn't exist
					}
					if ( existsSync( distNodeModulesPath ) ) {
						return;
					}
					// On Windows, plain symlinks require developer mode or admin. Use
					// junction for directories — it works without elevated privileges.
					const linkType = process.platform === 'win32' ? 'junction' : 'dir';
					try {
						symlinkSync( cliNodeModulesPath, distNodeModulesPath, linkType );
					} catch ( err ) {
						console.warn(
							`[vite] Could not symlink node_modules into dist (${
								( err as Error ).message
							}). Native modules may not resolve.`
						);
					}
				},
			},
		],
		build: {
			lib: {
				entry: {
					'eval-runner': resolve( __dirname, 'ai/eval-runner.ts' ),
				},
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
		},
	} )
);
