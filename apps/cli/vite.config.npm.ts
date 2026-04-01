import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
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
