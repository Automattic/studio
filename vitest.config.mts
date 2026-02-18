import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig( {
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
			'src/**/*.{test,spec}.{ts,tsx}',
			'cli/**/*.{test,spec}.{ts,tsx}',
			'common/**/*.{test,spec}.{ts,tsx}',
			'packages/**/*.{test,spec}.{ts,tsx,js}',
		],
		exclude: [
			'**/node_modules/**',
			'**/tests/utils/**',
			'**/stores/tests/utils/**',
			'**/vendor/**',
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
			pm2: path.resolve( __dirname, './__mocks__/pm2.ts' ),
			cli: path.resolve( __dirname, './cli' ),
			src: path.resolve( __dirname, './src' ),
			vendor: path.resolve( __dirname, './vendor' ),
			common: path.resolve( __dirname, './common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': path.resolve(
				__dirname,
				'./node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
	},
} );
