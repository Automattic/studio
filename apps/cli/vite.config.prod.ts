import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig, buildLocalUiPlugin } from './vite.config.base.ts';

const __dirname = import.meta.dirname;

const cliNodeModulesPath = resolve( __dirname, 'node_modules' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			buildLocalUiPlugin(),
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
				  ]
				: [] ),
		],
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
