import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			viteStaticCopy( {
				targets: [
					{
						src: 'ai/skills',
						dest: '.',
					},
					{
						src: 'ai/skill-overlays',
						dest: '.',
					},
				],
			} ),
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
