import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			sourcemap: false,
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
