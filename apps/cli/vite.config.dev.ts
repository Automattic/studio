import { existsSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { baseConfig } from './vite.config.base';

const aiPluginPath = resolve( __dirname, 'ai/plugin' );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [
			...( existsSync( aiPluginPath )
				? [
						viteStaticCopy( {
							targets: [
								{
									src: aiPluginPath,
									dest: '.',
								},
							],
						} ),
				  ]
				: [] ),
		],
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
			__ENABLE_STUDIO_AI__: true,
		},
	} )
);
