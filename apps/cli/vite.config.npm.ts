import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig, nodeBuiltins, packageJsonDependencies } from './vite.config.base';

// For npm publishing, externalize ALL dependencies (they're installed by the end user).
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
		],
		build: {
			sourcemap: false,
			rollupOptions: {
				output: {
					// Add shebang to main.mjs so it can be executed directly as a CLI.
					banner: ( chunk ) => ( chunk.fileName === 'main.mjs' ? '#!/usr/bin/env node' : '' ),
				},
				external: ( id ) => {
					if ( id.includes( 'blueprint-schema-validator' ) ) {
						return false;
					}
					if ( id.startsWith( 'node:' ) ) {
						return true;
					}
					if ( nodeBuiltins.some( ( b ) => id === b || id.startsWith( b + '/' ) ) ) {
						return true;
					}
					return packageJsonDependencies.some(
						( dep ) => id === dep || id.startsWith( dep + '/' )
					);
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
