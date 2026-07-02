import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		pool: 'threads',
		globals: true,
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
