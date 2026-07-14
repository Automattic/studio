import { defineConfig } from 'vitest/config';

// Standalone config (does not extend vitest.shared) on purpose: these are pure
// ESLint RuleTester tests that don't need jsdom or the playground/php-wasm
// global setup the shared config pulls in. Keep it minimal and node-only.
export default defineConfig( {
	test: {
		name: 'eslint-plugin-studio',
		include: [ 'tests/**/*.test.{ts,tsx}' ],
		environment: 'node',
		// eslint's RuleTester drives test definitions through the global
		// describe/it, so they must be exposed globally.
		globals: true,
	},
} );
