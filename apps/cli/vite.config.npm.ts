import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			sourcemap: false,
			rollupOptions: {
				output: {
					// Add shebang to main.js so it can be executed directly as a CLI.
					banner: ( chunk ) => ( chunk.fileName === 'main.js' ? '#!/usr/bin/env node' : '' ),
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__ENABLE_STUDIO_AI__: false,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
