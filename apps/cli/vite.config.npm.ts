import { defineConfig, mergeConfig } from 'vite';
import { baseConfig, buildLocalUiPlugin } from './vite.config.base.ts';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [ buildLocalUiPlugin() ],
		build: {
			sourcemap: false,
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
