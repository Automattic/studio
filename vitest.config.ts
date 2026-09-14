import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		projects: [
			'./apps/cli/vitest.config.ts',
			'./apps/local/vitest.config.ts',
			'./apps/studio/vitest.config.ts',
			'./apps/ui/vitest.config.ts',
			'./packages/common/vitest.config.ts',
			'./scripts/vitest.config.ts',
			'./tools/eslint-plugin-studio/vitest.config.ts',
		],
	},
} );
