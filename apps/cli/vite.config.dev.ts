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
						src: 'ai/plugin',
						dest: '.',
					},
				],
			} ),
		],
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
			__ENABLE_STUDIO_AI__: true,
		},
	} )
);
