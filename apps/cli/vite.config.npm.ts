import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const studioPanelsRoot = resolve( __dirname, '../studio-panels' );

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
					{
						src: `${ studioPanelsRoot }/studio-panels.php`,
						dest: 'studio-panels',
					},
					{
						src: `${ studioPanelsRoot }/version.txt`,
						dest: 'studio-panels',
					},
					{
						src: `${ studioPanelsRoot }/build`,
						dest: 'studio-panels',
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
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
