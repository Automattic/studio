import { defineConfig } from 'vitest/config';

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
