import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { exec as pkgExec } from '@yao-pkg/pkg';
import { globSync } from 'glob';
import { RecommendedPHPVersion } from '../../packages/common/types/php-versions';
import { windowsSign } from './windowsSign';
import type { ForgeConfig } from '@electron-forge/shared-types';

const repoRoot = path.resolve( __dirname, '../..' );
const bundledPhpBinaryRoot = path.join( __dirname, 'php-bin' );

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		// prePackage installs the self-contained production dependency tree.
		prune: false,
		extraResource: [
			path.join( __dirname, 'assets' ),
			path.join( __dirname, 'bin' ),
			bundledPhpBinaryRoot,
			path.join( repoRoot, 'apps', 'cli', 'dist', 'cli' ),
		],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: path.join( __dirname, 'assets', 'studio-app-icon' ),
		windowsSign,
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
		// Patterns are matched against paths inside the asar root, which is
		// apps/studio/ (electron-forge packages from this package). Anchor each
		// pattern at the asar root with a leading slash.
		ignore: [
			// Dev/test sources and fixtures — runtime uses /dist instead.
			/^\/\..*/, // dotfiles and dot directories
			/^\/src/,
			/^\/e2e/,
			/^\/__mocks__/,
			/^\/patches/,
			/^\/entitlements/,
			/^\/installers/,
			// Build-time helpers
			/^\/windowsSign\.ts$/,
			// Config files
			/^\/tsconfig\./,
			/^\/vitest\./,
			/^\/postcss\./,
			/^\/tailwind\./,
			/^\/forge\./,
			/^\/electron\./,
			/^\/index\.html$/,
			/^\/.*\.md$/,
			/^\/.*\.txt$/,
			/^\/.*\.log$/,
			// Resources copied separately via extraResource
			/^\/assets/,
			/^\/bin/,
		],
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				// Display name for app launchers and stores. Overrides
				// package.json.productName ("Studio") so Linux users see the
				// fully-qualified "WordPress Studio" in their menus.
				productName: 'WordPress Studio',
				categories: [ 'Utility' ],
				name: 'studio',
				bin: 'studio',
				// Synopsis and extended description shown by package managers and
				// software stores. Without these, electron-installer-debian falls
				// back to package.json.description for both, producing a duplicated
				// Description block. Copy mirrors the Microsoft Store listing.
				description: 'Meet Studio - a fast, free way to develop locally with WordPress.',
				productDescription:
					"Simplify WordPress site creation and management with Studio - WordPress.com's powerful, lightweight local development tool. Studio streamlines your workflow with instant WordPress setup, one-click WP Admin access, and a code-agnostic environment. No Docker, MySQL, or NGINX required. Get real-time feedback from clients or collaborators with easy-to-share demo sites. And with help from Studio Code, you can speed up plugin management, run WP-CLI commands, and automate tasks right from the intuitive chat interface.",
				mimeType: [ 'x-scheme-handler/wp-studio' ],
				icon: path.join( __dirname, 'assets', 'studio-app-icon.png' ),
				desktopTemplate: path.join( __dirname, 'installers', 'desktop.ejs' ),
				// libcap2-bin: ships `setcap`, used by postinst to grant the bundled
				// node CAP_NET_BIND_SERVICE so the proxy can bind ports 80/443.
				// pkexec | policykit-1: provides `pkexec`, used by @vscode/sudo-prompt for
				// hosts-file writes. `policykit-1` is the legacy package name (Ubuntu 24.04
				// and older Debian); on Debian trixie / Kali rolling polkit was split and
				// `pkexec` ships as its own binary package. The alternative makes the
				// dependency resolvable on both.
				// ca-certificates: ships `update-ca-certificates` and the system trust bundle.
				// libnss3-tools: ships `certutil`, used to import the CA into per-user NSS DBs.
				depends: [ 'libcap2-bin', 'pkexec | policykit-1', 'ca-certificates', 'libnss3-tools' ],
				scripts: {
					postinst: path.join( __dirname, 'installers', 'linux', 'postinst.sh' ),
					postrm: path.join( __dirname, 'installers', 'linux', 'postrm.sh' ),
				},
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

				// Sign via the custom Azure Trusted Signing hook (signtool, SHA256-only).
				// Undefined when SIGN_WINDOWS_BUILD isn't set (e.g. package-only jobs), leaving the build unsigned.
				...( windowsSign ? { windowsSign } : {} ),
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
			// Use execFile with shell:true and an explicit args array. The shell
			// is required on Windows so that npm (a .cmd batch file) can be
			// resolved; passing args as an array rather than an interpolated
			// string still prevents shell metacharacters in path values from
			// altering the meaning of the command.
			const execAsync = ( args: string[], env: NodeJS.ProcessEnv = {} ) =>
				new Promise< void >( ( resolve, reject ) => {
					execFile(
						args[ 0 ],
						args.slice( 1 ),
						{
							cwd: repoRoot,
							env: { ...process.env, ...env },
							maxBuffer: 50 * 1024 * 1024,
							windowsHide: true,
							shell: true,
						},
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

			console.log( 'Installing Studio app dependencies for bundling ...' );
			// NOTE: The `app:install:bundle` script mutates the `apps/studio/node_modules` directory. You
			// may need to rerun `npm ci` from the repo root to reset the dependency tree after packaging.
			const studioNodeModules = path.join( repoRoot, 'apps', 'studio', 'node_modules' );
			fs.rmSync( studioNodeModules, { recursive: true, force: true } );
			await execAsync( [ 'npm', 'run', 'app:install:bundle' ] );

			if ( process.env.SKIP_LANGUAGE_PACKS ) {
				console.log( 'Skipping language packs because SKIP_LANGUAGE_PACKS is set ...' );
			} else {
				console.log( 'Downloading language packs ...' );
				await execAsync( [ 'npm', 'run', 'download-language-packs' ] );
			}

			console.log( 'Building CLI (with bundled node_modules) ...' );
			// NOTE: The `cli:package` script mutates the `apps/cli/node_modules` directory. You may need to
			// rerun `npm ci` from the repo root to reset the dependency tree after packaging.
			const cliNodeModulesSource = path.join( repoRoot, 'apps', 'cli', 'node_modules' );
			fs.rmSync( cliNodeModulesSource, { recursive: true, force: true } );
			await execAsync( [ 'npm', 'run', 'cli:package' ] );

			// Remove native binaries for other platforms from CLI's node_modules.
			// Some packages ship binaries for all platforms which causes code-signing failures
			// on Windows when signtool encounters non-PE binaries (e.g., darwin .node files).
			console.log( `Removing native binaries for other platforms from CLI bundle...` );
			const cliNodeModules = path.join( repoRoot, 'apps', 'cli', 'dist', 'cli', 'node_modules' );

			// Clean up koffi binaries (uses {platform}_{arch} format).
			const koffiBuildDir = path.join( cliNodeModules, 'koffi', 'build', 'koffi' );
			const koffiTarget = `${ platform }_${ arch }`;
			if ( fs.existsSync( koffiBuildDir ) ) {
				const koffiDirs = fs.readdirSync( koffiBuildDir );
				const koffiTargetPath = path.join( koffiBuildDir, koffiTarget );
				// Refuse to delete anything unless the target arch is present *as a directory* —
				// guards against a koffi naming/layout change silently nuking every prebuilt.
				const targetIsDir =
					fs.existsSync( koffiTargetPath ) && fs.statSync( koffiTargetPath ).isDirectory();
				if ( ! targetIsDir ) {
					console.warn(
						`Skipping koffi cleanup: no directory named ${ koffiTarget } in ${ koffiBuildDir }`
					);
				} else {
					for ( const platformArchDir of koffiDirs ) {
						if ( platformArchDir !== koffiTarget ) {
							const dirToRemove = path.join( koffiBuildDir, platformArchDir );
							if ( fs.statSync( dirToRemove ).isDirectory() ) {
								fs.rmSync( dirToRemove, { recursive: true, force: true } );
								console.log( `Removed koffi/build/koffi/${ platformArchDir }` );
							}
						}
					}
				}
			}

			// Clean up fs-ext-extra-prebuilt binaries (file format:
			// fs-ext-{platform}-{arch}-{runtime}-{version}.node). The root postinstall
			// already filtered by platform; this strips the unused arch for the target build.
			const fsExtBinDir = path.join( cliNodeModules, 'fs-ext-extra-prebuilt', 'binaries' );
			const fsExtPrefix = `fs-ext-${ platform }-${ arch }-`;
			if ( fs.existsSync( fsExtBinDir ) ) {
				const fsExtFiles = fs.readdirSync( fsExtBinDir );
				if ( ! fsExtFiles.some( ( f ) => f.startsWith( fsExtPrefix ) ) ) {
					console.warn(
						`Skipping fs-ext cleanup: no file starting with ${ fsExtPrefix } in ${ fsExtBinDir }`
					);
				} else {
					for ( const file of fsExtFiles ) {
						if ( ! file.startsWith( fsExtPrefix ) ) {
							// Tolerate transient failures (Windows AV locks, permissions) — this
							// cleanup is a size optimization; aborting packaging over a stuck file
							// would be worse than shipping a few hundred extra KB. Mirrors the
							// behavior of scripts/remove-fs-ext-other-platform-binaries.mjs.
							try {
								fs.unlinkSync( path.join( fsExtBinDir, file ) );
								console.log( `Removed fs-ext-extra-prebuilt/binaries/${ file }` );
							} catch ( e ) {
								const message = e instanceof Error ? e.message : String( e );
								console.warn(
									`Could not remove fs-ext-extra-prebuilt/binaries/${ file }: ${ message }`
								);
							}
						}
					}
				}
			}

			// Strip AI provider SDKs Studio never loads (Mistral, AWS Bedrock, Google). pi-ai
			// loads them lazily and Studio only exposes Anthropic/OpenAI, so they're dead weight —
			// and @mistralai's ~200-char generated filenames, nested under pi-coding-agent, blow
			// past Windows' 260-char path limit and crash the Squirrel maker.
			console.log( 'Removing unused AI provider SDKs from CLI bundle...' );
			const unusedProviderPatterns = [
				'{@mistralai,@aws-sdk,@aws-crypto,@smithy,@google/genai}/',
				'**/node_modules/{@mistralai,@aws-sdk,@aws-crypto,@smithy,@google/genai}/',
			];
			const unusedProviderPaths = globSync( unusedProviderPatterns, {
				cwd: cliNodeModules,
				absolute: true,
			} );
			for ( const providerPath of unusedProviderPaths ) {
				fs.rmSync( providerPath, { recursive: true, force: true } );
				console.log( `Removed ${ providerPath }` );
			}
			if ( platform === 'win32' ) {
				// Verify the prune succeeded — a leftover provider tree on Windows resurfaces as
				// the PathTooLongException the prune exists to prevent. Fail now with context
				// instead of letting the Squirrel maker crash later.
				const remaining = globSync( unusedProviderPatterns, {
					cwd: cliNodeModules,
					absolute: true,
				} );
				if ( remaining.length > 0 ) {
					throw new Error(
						`Could not prune ${ remaining.length } provider director(ies) that exceed ` +
							`Windows' 260-char path limit: ${ remaining.join( ', ' ) }`
					);
				}
			}

			console.log( `Downloading Node.js binary for ${ platform }-${ arch }...` );
			await execAsync( [
				'npx',
				'tsx',
				path.join( repoRoot, 'scripts', 'download-node-binary.ts' ),
				platform,
				arch,
			] );

			console.log(
				`Downloading PHP ${ RecommendedPHPVersion } package for ${ platform }-${ arch }...`
			);
			fs.rmSync( bundledPhpBinaryRoot, { recursive: true, force: true } );
			await execAsync(
				[
					'npx',
					'tsx',
					path.join( repoRoot, 'scripts', 'download-php-binary.ts' ),
					RecommendedPHPVersion,
					platform,
					arch,
					'--install-root',
					bundledPhpBinaryRoot,
				],
				{
					STUDIO_PHP_BINARY_DOWNLOAD_REQUIRED: '1',
				}
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
