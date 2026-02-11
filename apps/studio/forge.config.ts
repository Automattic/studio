import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ForgeConfig } from '@electron-forge/shared-types';

const repoRoot = path.resolve( __dirname, '../..' );

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [
			path.join( repoRoot, 'wp-files' ),
			path.join( __dirname, 'assets' ),
			path.join( __dirname, 'bin' ),
			path.join( repoRoot, 'apps', 'cli', 'dist', 'cli' ),
		],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: path.join( __dirname, 'assets', 'studio-app-icon' ),
		osxSign: {
			optionsForFile: ( filePath ) => {
				// The bundled Node binary requires specific entitlements for V8 JIT compilation.
				// Without these, V8 crashes with SIGTRAP when trying to allocate executable memory.
				if ( filePath.endsWith( 'bin/node' ) ) {
					return {
						entitlements: path.join( repoRoot, 'apps', 'studio', 'entitlements', 'node.plist' ),
					};
				}
				return {};
			},
		},
		ignore: [
			// Exclude major development directories
			/^\/\..*/, // All dotfiles and dot directories
			/^\/apps\/studio\/src/,
			/^\/apps\/studio\/e2e/,
			/^\/apps\/cli/,
			/^\/tools\/common/,
			/^\/vendor/,
			/^\/fastlane/,
			/^\/docs/,
			/^\/scripts/,
			/^\/tools/,
			/^\/patches/,
			/^\/tools\/metrics/,
			/^\/test-results/,
			/^\/webpack-loaders/,
			/^\/apps\/studio\/installers/,
			// Config files
			/^\/webpack\./,
			/^\/tsconfig\./,
			/^\/vitest\./,
			/^\/playwright\./,
			/^\/postcss\./,
			/^\/tailwind\./,
			/^\/forge\./,
			/^\/electron\./,
			/^\/apps\/studio\/.*\\.config\\./,
			/^\/apps\/studio\/tailwind\\.config\\.js$/,
			/^\/apps\/studio\/postcss\\.config\\.js$/,
			/^\/apps\/studio\/index\.html$/,
			/^\/Gemfile/,
			/^\/.*\.md$/,
			/^\/.*\.txt$/,
			/^\/.*\.log$/,
			// External resources (shouldn't be in asar)
			/^\/assets/,
			/^\/bin/,
			/^\/wp-files/,
			/^\/apps\/cli\/dist\/cli/,
			/^\/dist\/playground-cli/,
		],
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				genericName: 'WordPress Studio',
				categories: [ 'Utility' ],
				name: 'studio',
			},
		} ),
		new MakerSquirrel(
			{
				loadingGif: path.join( __dirname, 'installers', 'loading.gif' ),
				setupIcon: path.join( __dirname, 'assets', 'studio-app-icon.ico' ),
				// This icon is shown in Control Panel -> Programs and Features
				// Windows Explorer caches the icon agressively; use the cache busting param when necessary.
				iconUrl: 'https://s0.wp.com/i/studio-app/studio-app-icon.ico?v=3',

				setupExe: 'studio-setup.exe',

				certificateFile: 'certificate.pfx',
				certificatePassword: process.env.WINDOWS_CODE_SIGNING_CERT_PASSWORD,
			},
			[ 'win32' ]
		),
		...( process.env.SKIP_DMG
			? []
			: [
					new MakerDMG(
						{
							icon: path.join( __dirname, 'assets', 'studio-app-icon.icns' ),
							background: path.join( __dirname, 'assets', 'dmg-background.png' ),
							contents: [
								{
									x: 533,
									y: 122,
									type: 'file',
									path: `${ process.cwd() }/out/Studio-darwin-${
										process.env.FILE_ARCHITECTURE || 'arm64'
									}/Studio.app`,
								},
								{ x: 533, y: 354, type: 'link', path: '/Applications' },
							],
							additionalDMGOptions: {
								window: {
									size: {
										width: 710,
										height: 502,
									},
								},
							},
						},
						[ 'darwin' ]
					),
			  ] ),
	],
	plugins: [ new AutoUnpackNativesPlugin( {} ) ],
	hooks: {
		prePackage: async ( _forgeConfig, platform, arch ) => {
			const execAsync = promisify( exec );

			console.log( "Ensuring latest WordPress zip isn't included in production build ..." );
			const zipPath = path.join( repoRoot, 'wp-files', 'latest.zip' );
			try {
				fs.unlinkSync( zipPath );
			} catch ( err ) {
				if ( isErrnoException( err ) && err.code !== 'ENOENT' ) throw err;
			}

			console.log( 'Installing Studio app dependencies for bundling ...' );
			await execAsync( 'npm run app:install:bundle', { cwd: repoRoot } );

			console.log( 'Building CLI (with bundled node_modules) ...' );
			await execAsync( 'npm run cli:build:bundle', { cwd: repoRoot } );

			console.log( `Downloading Node.js binary for ${ platform }-${ arch }...` );
			await execAsync(
				`npx ts-node ${ path.join(
					repoRoot,
					'scripts',
					'download-node-binary.ts'
				) } ${ platform } ${ arch }`,
				{ cwd: repoRoot }
			);
		},
		postPackage: async (forgeConfig, options) => {
			fs.rmSync( path.join( repoRoot, 'apps', 'cli', 'node_modules' ), { recursive: true } );
			fs.rmSync( path.join( repoRoot, 'apps', 'studio', 'node_modules' ), { recursive: true } );
		},
	},
};

export default config;
