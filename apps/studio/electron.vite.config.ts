import { resolve } from 'path';
import { defineConfig } from 'electron-vite';

export default defineConfig( {
	main: {
		plugins: [],
		resolve: {
			alias: {
				src: resolve( __dirname, 'src' ),
				'@studio/common': resolve( __dirname, '../../packages/common' ),
				'@studio/agent': resolve( __dirname, '../../packages/agent' ),
				'@wp-playground/blueprints/blueprint-schema-validator': resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
		define: {
			'process.env.NODE_ENV': JSON.stringify( process.env.NODE_ENV ),
			COMMIT_HASH: JSON.stringify(
				process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT ?? 'dev'
			),
		},
		build: {
			rolldownOptions: {
				input: {
					index: resolve( __dirname, 'src/index.ts' ),
				},
				output: {
					entryFileNames: '[name].js',
				},
			},
		},
	},
	preload: {
		build: {
			externalizeDeps: { exclude: [ '@sentry/electron' ] },
			rolldownOptions: {
				input: {
					preload: resolve( __dirname, 'src/preload.ts' ),
				},
				output: {
					entryFileNames: '[name].js',
					format: 'cjs',
				},
			},
		},
	},
} );
