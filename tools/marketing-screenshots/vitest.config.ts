import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		include: [ 'tools/marketing-screenshots/**/*.test.ts' ],
	},
} );
