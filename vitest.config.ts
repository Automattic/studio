import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		environmentOptions: {
			customExportConditions: ['node', 'node-addons'],
		},
		include: [
			'src/**/*.{test,spec}.{ts,tsx}',
			'cli/**/*.{test,spec}.{ts,tsx}',
			'common/**/*.{test,spec}.{ts,tsx}',
		],
		exclude: [
			'**/node_modules/**',
			'**/tests/utils/**',
			'**/stores/tests/utils/**',
			'**/vendor/**',
		],
		globalSetup: './vitest.global-setup.ts',
		setupFiles: ['./vitest.setup.ts'],
		server: {
			deps: {
				inline: ['@php-wasm', '@wp-playground'],
			},
		},
		poolOptions: {
			threads: {
				maxThreads: 8,
				minThreads: 1,
			},
		},
		css: false,
	},
	resolve: {
		alias: {
			cli: path.resolve(__dirname, './cli'),
			src: path.resolve(__dirname, './src'),
			vendor: path.resolve(__dirname, './vendor'),
			common: path.resolve(__dirname, './common'),
		},
	},
});
