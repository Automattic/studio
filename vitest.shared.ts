import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		pool: 'threads',
		globals: true,
		// Registered test tags for selective runs, e.g. `npm test -- --tagsFilter='e2e'`
		// or excluding the slow real-CLI tests with `--tagsFilter='!e2e'`.
		tags: [
			{
				name: 'e2e',
				description:
					'Real end-to-end tests that spawn the built CLI and create real sites. Require `npm run cli:build` first; run in the slower (release/manual) suite, not per-PR.',
			},
		],
		environment: 'jsdom',
		environmentOptions: {
			customExportConditions: [ 'node', 'node-addons' ],
		},
		exclude: [
			'**/node_modules/**',
			'**/tests/utils/**',
			'**/stores/tests/utils/**',
			'**/vendor/**',
		],
		globalSetup: path.resolve( __dirname, './vitest.global-setup.ts' ),
		server: {
			deps: {
				inline: [ '@php-wasm', '@wp-playground' ],
				external: [ 'electron' ],
			},
		},
		css: false,
	},
} );
