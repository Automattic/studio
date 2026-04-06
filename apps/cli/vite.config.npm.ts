import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const cliBinaries = [ 'main.mjs', 'ai-main.mjs' ];

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
					// Add shebang to CLI binaries so they can be executed directly.
					banner: ( chunk ) =>
						cliBinaries.includes( chunk.fileName ) ? '#!/usr/bin/env node' : '',
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
