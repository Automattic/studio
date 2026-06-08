import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			lib: {
				entry: {
					'eval-runner': resolve( __dirname, 'ai/eval-runner.ts' ),
					'eval-wsg': resolve( __dirname, 'ai/eval-wsg/run.ts' ),
				},
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
		},
	} )
);
