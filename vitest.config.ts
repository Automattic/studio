import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		projects: [
			'./apps/cli/vitest.config.ts',
			'./apps/studio/vitest.config.ts',
			'./tools/common/vitest.config.ts',
		],
	},
} );
