import { defineConfig, mergeConfig } from 'vite';
import { baseConfig, nodeBuiltinExternals } from './vite.config.base';

export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			rollupOptions: {
				external: [
					...nodeBuiltinExternals,
					// `trash` includes a native macOS binary that Vite/Rollup inlines as a base64 string, which
					// generates an error in the production build
					'trash',
					// Fundamentally, yargs works well with Vite/Rollup bundling. The only issue is that it uses
					// __filename-based lookups for JSON translation files, which breaks when bundling. This is a
					// pragmatic solution to that problem.
					'yargs',
					'@php-wasm/node',
					'@php-wasm/web',
					'@php-wasm/logger',
					'@php-wasm/universal',
					'@php-wasm/scopes',
					'@wp-playground/cli',
					'@wp-playground/blueprints',
					'@wp-playground/wordpress',
					'@anthropic-ai/claude-agent-sdk',
					'koffi',
					'playwright',
					'playwright-core',
				],
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: false,
			__ENABLE_CLI_TELEMETRY__: false,
		},
	} )
);
