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
