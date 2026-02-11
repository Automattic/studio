import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { getSentryReleaseInfo } from './src/lib/sentry-release';

const version = process.env.npm_package_version || '';
const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo( version );
console.log( 'Sentry release version:', sentryRelease );
console.log( 'Sentry environment:', isDevEnvironment ? 'development' : 'production' );

export default defineConfig( {
	main: {
		plugins: [],
		resolve: {
			alias: {
				src: resolve( __dirname, 'src' ),
				'@studio/common': resolve( __dirname, '../../tools/common' ),
				cli: resolve( __dirname, '../cli' ),
				vendor: resolve( __dirname, '../../vendor' ),
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
			lib: {
				entry: resolve( __dirname, 'src/preload.ts' ),
			},
		},
	},
	renderer: {
		root: __dirname,
		resolve: {
			alias: {
				src: resolve( __dirname, 'src' ),
				'@studio/common': resolve( __dirname, '../../tools/common' ),
				cli: resolve( __dirname, '../cli' ),
				vendor: resolve( __dirname, '../../vendor' ),
				'@wp-playground/blueprints/blueprint-schema-validator': resolve(
					__dirname,
					'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
				),
			},
		},
		plugins: [
			react(),
			topLevelAwait(),
			wasm(),
			viteStaticCopy( {
				targets: [
					{
						src: resolve( __dirname, '../../node_modules/@rive-app/canvas/rive.wasm' ),
						dest: 'assets',
					},
					{
						src: resolve( __dirname, '../../node_modules/@rive-app/canvas/rive_fallback.wasm' ),
						dest: 'assets',
					},
					{
						src: resolve( __dirname, 'src/about-menu/about-menu.html' ),
						dest: '.',
					},
					{
						src: resolve( __dirname, 'src/about-menu/studio-app-icon.png' ),
						dest: '.',
					},
				],
			} ),
			// Sentry must be the last plugin
			! isDevEnvironment &&
				!! process.env.SENTRY_AUTH_TOKEN &&
				sentryVitePlugin( {
					authToken: process.env.SENTRY_AUTH_TOKEN,
					org: 'a8c',
					project: 'studio',
					release: {
						name: sentryRelease,
					},
				} ),
		].filter( Boolean ),
		css: {
			// Ensure CSS injection order is preserved - WordPress styles first, then custom styles
			devSourcemap: true,
			postcss: resolve( __dirname, 'postcss.config.js' ),
		},
		assetsInclude: [ '**/*.riv', '**/*.wasm' ],
		optimizeDeps: {
			include: [ '@wordpress/i18n', '@rive-app/react-canvas', '@rive-app/canvas' ],
			esbuildOptions: {
				sourcemap: false,
			},
		},
		server: {
			fs: {
				allow: [ '..', '../..' ],
			},
		},
		build: {
			sourcemap: true,
			rollupOptions: {
				input: resolve( __dirname, 'index.html' ),
				output: {
					// Extract CSS into separate files (like Webpack's MiniCssExtractPlugin)
					assetFileNames: ( assetInfo ) => {
						if ( assetInfo.name && assetInfo.name.endsWith( '.css' ) ) {
							return 'assets/[name]-[hash][extname]';
						}
						return 'assets/[name]-[hash][extname]';
					},
					// Optimize chunk splitting for better caching
					manualChunks: {
						vendor: [ 'react', 'react-dom', '@wordpress/components', '@wordpress/element' ],
						sentry: [ '@sentry/react', '@sentry/electron' ],
					},
				},
			},
			// Force CSS extraction instead of inlining
			cssCodeSplit: true,
			// Enable minification and compression
			minify: 'esbuild',
			// Target modern browsers for smaller output
			target: 'chrome120',
		},
	},
} );
