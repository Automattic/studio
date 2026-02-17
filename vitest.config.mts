import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig( {
	assetsInclude: [ '**/*.riv' ],
	test: {
		pool: 'threads',
		maxThreads: 8,
		minThreads: 1,
		globals: true,
		environment: 'jsdom',
		environmentOptions: {
			customExportConditions: [ 'node', 'node-addons' ],
		},
		include: [
			'apps/studio/src/**/*.{test,spec}.{ts,tsx}',
			'apps/cli/**/*.{test,spec}.{ts,tsx}',
			'tools/common/**/*.{test,spec}.{ts,tsx}',
			'tools/**/*.{test,spec}.{ts,tsx,js}',
		],
		exclude: [
			'**/node_modules/**',
			'**/tests/utils/**',
			'**/stores/tests/utils/**',
			'**/vendor/**',
			'tools/metrics/tests/**',
		],
		globalSetup: './vitest.global-setup.ts',
		setupFiles: [ './vitest.setup.ts' ],
		server: {
			deps: {
				inline: [ '@php-wasm', '@wp-playground' ],
				external: [ 'electron' ],
			},
		},
		css: false,
	},
	resolve: {
		alias: {
			pm2: path.resolve( __dirname, './apps/cli/__mocks__/pm2.ts' ),
			cli: path.resolve( __dirname, './apps/cli' ),
			src: path.resolve( __dirname, './apps/studio/src' ),
			vendor: path.resolve( __dirname, './vendor' ),
			'@studio/common': path.resolve( __dirname, './tools/common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
				__dirname,
				'./node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
	},
} );
