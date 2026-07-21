import { defineConfig } from 'vitest/config';

// Standalone config (does not extend vitest.shared) on purpose: these are pure
// Node script tests that don't need jsdom or the playground/php-wasm global
// setup the shared config pulls in.
export default defineConfig( {
	test: {
		name: 'scripts',
		include: [ '**/*.test.mjs' ],
		environment: 'node',
	},
} );
