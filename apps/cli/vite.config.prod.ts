import { defineConfig, mergeConfig } from 'vite';
import devConfig from './vite.config.dev';

export default mergeConfig(
	devConfig,
	defineConfig( {
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
		},
	} )
);
