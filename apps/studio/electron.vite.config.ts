import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'electron-vite';
import { getSentryReleaseInfo } from './src/lib/sentry-release';

// Release builds upload the main process's source maps under the app's release, like the
// renderer's (`apps/ui/vite.config.ts`), and don't ship them.
const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo(
	JSON.parse( readFileSync( resolve( __dirname, 'package.json' ), 'utf-8' ) ).version
);
const uploadSourceMaps = ! isDevEnvironment && !! process.env.SENTRY_AUTH_TOKEN;

export default defineConfig( {
	main: {
		plugins: [
			uploadSourceMaps &&
				sentryVitePlugin( {
					authToken: process.env.SENTRY_AUTH_TOKEN,
					org: 'a8c',
					project: 'studio',
					release: { name: sentryRelease },
					sourcemaps: { filesToDeleteAfterUpload: [ resolve( __dirname, 'dist/main/**/*.map' ) ] },
				} ),
		],
		resolve: {
			alias: {
				src: resolve( __dirname, 'src' ),
				'@studio/common': resolve( __dirname, '../../packages/common' ),
				'@studio/agent': resolve( __dirname, '../../packages/agent' ),
				'@studio/providers': resolve( __dirname, '../../packages/providers' ),
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
			sourcemap: uploadSourceMaps ? 'hidden' : false,
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
