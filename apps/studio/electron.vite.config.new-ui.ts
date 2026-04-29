/**
 * Electron-vite dev config for running the Electron app with the new @studio/ui renderer.
 * Builds main + preload in development mode; skips the renderer since it's handled
 * by the @studio/ui Vite dev server (pointed to via ELECTRON_RENDERER_URL).
 */

import { resolve } from 'path';
import { defineConfig } from 'electron-vite';

export default defineConfig( {
	main: {
		plugins: [],
		resolve: {
			alias: {
				src: resolve( __dirname, 'src' ),
				'@studio/common': resolve( __dirname, '../../tools/common' ),
				'@wp-playground/blueprints/blueprint-schema-validator': resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
		define: {
			'process.env.NODE_ENV': JSON.stringify( process.env.NODE_ENV ),
			COMMIT_HASH: JSON.stringify( 'dev' ),
		},
		build: {
			externalizeDeps: {
				exclude: [ '@studio/common' ],
			},
			rollupOptions: {
				input: {
					index: resolve( __dirname, 'src/index.ts' ),
				},
				output: {
					entryFileNames: '[name].js',
				},
				external: [ /^@php-wasm\/.*/ ],
			},
		},
	},
	preload: {
		build: {
			externalizeDeps: { exclude: [ '@sentry/electron' ] },
			rollupOptions: {
				input: {
					preload: resolve( __dirname, 'src/preload.ts' ),
					'preview-preload': resolve( __dirname, 'src/preview-preload.ts' ),
				},
				output: {
					entryFileNames: '[name].js',
					format: 'cjs',
				},
			},
		},
	},
} );
