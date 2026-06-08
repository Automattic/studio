import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		projects: [
			'./scripts/vitest.config.ts',
			'./apps/cli/vitest.config.ts',
			'./apps/studio/vitest.config.ts',
			'./apps/ui/vitest.config.ts',
			'./tools/common/vitest.config.ts',
			'./tools/eslint-plugin-studio/vitest.config.ts',
		],
	},
} );
