import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { exec } from 'child_process';
import { exec as pkgExec } from '@yao-pkg/pkg';
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

				// CI code-signing setup writes certificate.pfx at the repository root.
				certificateFile: path.join( repoRoot, 'certificate.pfx' ),
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
								{ x: 900, y: 900, type: 'position', path: '.background' },
								{ x: 900, y: 900, type: 'position', path: '.DS_Store' },
								{ x: 900, y: 900, type: 'position', path: '.Trashes' },
								{ x: 900, y: 900, type: 'position', path: '.VolumeIcon.icns' },
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
			const execAsync = ( command: string ) =>
				new Promise< void >( ( resolve, reject ) => {
					exec(
						command,
						{ cwd: repoRoot, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
						( error, stdout, stderr ) => {
							if ( error ) {
								if ( stdout ) console.log( stdout );
								if ( stderr ) console.error( stderr );
								reject( error );
							} else {
								resolve();
							}
						}
					);
				} );

			console.log( "Ensuring latest WordPress zip isn't included in production build ..." );
			const zipPath = path.join( repoRoot, 'wp-files', 'latest.zip' );
			try {
				fs.unlinkSync( zipPath );
			} catch ( err ) {
				if ( isErrnoException( err ) && err.code !== 'ENOENT' ) throw err;
			}

			console.log( 'Installing Studio app dependencies for bundling ...' );
			// NOTE: The `app:install:bundle` script mutates the `apps/studio/node_modules` directory. You
			// may need to rerun `npm ci` from the repo root to reset the dependency tree after packaging.
			await execAsync( 'npm run app:install:bundle' );

			console.log( 'Building CLI (with bundled node_modules) ...' );
			// NOTE: The `cli:package` script mutates the `apps/cli/node_modules` directory. You may need to
			// rerun `npm ci` from the repo root to reset the dependency tree after packaging.
			await execAsync( 'npm run cli:package' );

			// Remove native binaries for other platforms from CLI's node_modules.
			// Some packages ship binaries for all platforms which causes code-signing failures
			// on Windows when signtool encounters non-PE binaries (e.g., darwin .node files).
			console.log( `Removing native binaries for other platforms from CLI bundle...` );
			const cliNodeModules = path.join( repoRoot, 'apps', 'cli', 'dist', 'cli', 'node_modules' );

			// Clean up @anthropic-ai/claude-agent-sdk vendor binaries (uses {arch}-{platform} format)
			const claudeVendorDir = path.join( cliNodeModules, '@anthropic-ai', 'claude-agent-sdk', 'vendor' );
			const platformSuffix = `-${ platform }`;
			if ( fs.existsSync( claudeVendorDir ) ) {
				for ( const toolDir of fs.readdirSync( claudeVendorDir ) ) {
					const toolPath = path.join( claudeVendorDir, toolDir );
					if ( fs.statSync( toolPath ).isDirectory() ) {
						for ( const archPlatformDir of fs.readdirSync( toolPath ) ) {
							if ( ! archPlatformDir.endsWith( platformSuffix ) ) {
								const dirToRemove = path.join( toolPath, archPlatformDir );
								fs.rmSync( dirToRemove, { recursive: true, force: true } );
								console.log( `Removed claude-agent-sdk/vendor/${ toolDir }/${ archPlatformDir }` );
							}
						}
					}
				}
			}

			// Clean up koffi binaries (uses {platform}_{arch} format)
			const koffiBuildDir = path.join( cliNodeModules, 'koffi', 'build', 'koffi' );
			const platformPrefix = `${ platform }_`;
			if ( fs.existsSync( koffiBuildDir ) ) {
				for ( const platformArchDir of fs.readdirSync( koffiBuildDir ) ) {
					if ( ! platformArchDir.startsWith( platformPrefix ) ) {
						const dirToRemove = path.join( koffiBuildDir, platformArchDir );
						if ( fs.statSync( dirToRemove ).isDirectory() ) {
							fs.rmSync( dirToRemove, { recursive: true, force: true } );
							console.log( `Removed koffi/build/koffi/${ platformArchDir }` );
						}
					}
				}
			}

			console.log( 'Downloading language packs ...' );
			await execAsync( 'npm run download-language-packs' );

			console.log( `Downloading Node.js binary for ${ platform }-${ arch }...` );
			await execAsync(
				`npx ts-node ${ path.join(
					repoRoot,
					'scripts',
					'download-node-binary.ts'
				) } ${ platform } ${ arch }`
			);

			// Build CLI launcher executable for Windows AppX (Microsoft Store).
			// AppX packages require AppExecutionAlias with an .exe target — batch files won't work.
			if ( platform === 'win32' ) {
				const pkgArch = arch === 'x64' ? 'x64' : 'arm64';
				const target = `node22-win-${ pkgArch }`;
				console.log( `Building CLI launcher executable for ${ target }...` );
				await pkgExec( [
					'bin/studio-cli-launcher.js',
					'--target',
					target,
					'--output',
					'bin/studio-cli.exe',
					'--compress',
					'GZip',
					'--no-bytecode',
					'--public',
				] );
			}
		},
	},
};

export default config;
