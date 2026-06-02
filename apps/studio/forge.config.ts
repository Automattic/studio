import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { RecommendedPHPVersion } from '../../tools/common/types/php-versions';
import { windowsSign } from './windowsSign';
import type { ForgeConfig } from '@electron-forge/shared-types';

const repoRoot = path.resolve( __dirname, '../..' );
const bundledPhpBinaryRoot = path.join( __dirname, 'php-bin' );

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [
			path.join( __dirname, 'assets' ),
			path.join( __dirname, 'bin' ),
			bundledPhpBinaryRoot,
		],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: path.join( __dirname, 'assets', 'studio-app-icon' ),
		windowsSign,
		osxSign: {
			optionsForFile: ( filePath ) => {
				// The bundled binary requires specific entitlements for V8 JIT.
				// Without these, V8 crashes with SIGTRAP when trying to allocate executable memory.
				if ( filePath.endsWith( 'bin/studio' ) ) {
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
					"Simplify WordPress site creation and management with Studio - WordPress.com's powerful, lightweight local development tool. Studio streamlines your workflow with instant WordPress setup, one-click WP Admin access, and a code-agnostic environment. No Docker, MySQL, or NGINX required. Get real-time feedback from clients or collaborators with easy-to-share demo sites. And with help from Studio Assistant, you can speed up plugin management, run WP-CLI commands, and automate tasks right from the intuitive chat interface.",
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

				// Azure mode: use the custom signing hook that calls signtool
				// with Azure Trusted Signing parameters.
				// PFX mode: use the local certificate file and password.
				...( windowsSign
					? { windowsSign }
					: {
							certificateFile: path.join( repoRoot, 'certificate.pfx' ),
							certificatePassword: process.env.WINDOWS_CODE_SIGNING_CERT_PASSWORD,
					  } ),
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
			const execAsync = ( command: string, env: NodeJS.ProcessEnv = {} ) =>
				new Promise< void >( ( resolve, reject ) => {
					exec(
						command,
						{
							cwd: repoRoot,
							env: { ...process.env, ...env },
							maxBuffer: 50 * 1024 * 1024,
							windowsHide: true,
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
			await execAsync( 'npm run app:install:bundle' );

			if ( process.env.SKIP_LANGUAGE_PACKS ) {
				console.log( 'Skipping language packs because SKIP_LANGUAGE_PACKS is set ...' );
			} else {
				console.log( 'Downloading language packs ...' );
				await execAsync( 'npm run download-language-packs' );
			}

			console.log( `Building CLI bundle for ${ platform }-${ arch }...` );
			await execAsync(
				`npx tsx ${ path.join(
					repoRoot,
					'scripts',
					'create-standalone-bundle.ts'
				) } ${ platform } ${ arch }`
			);

			const cliBinaryName =
				platform === 'win32'
					? `studio-cli-${ platform }-${ arch }.exe`
					: `studio-cli-${ platform }-${ arch }`;
			const cliSource = path.join( repoRoot, 'standalone-bundles', cliBinaryName );
			const cliDest = path.join( __dirname, 'bin', platform === 'win32' ? 'studio.exe' : 'studio' );
			const cliSidecarSource = `${ cliSource }.node_modules.tar.gz`;
			const cliSidecarDest = `${ cliDest }.node_modules.tar.gz`;
			fs.copyFileSync( cliSource, cliDest );
			fs.copyFileSync( cliSidecarSource, cliSidecarDest );
			if ( platform !== 'win32' ) {
				fs.chmodSync( cliDest, 0o755 );
			}

			console.log(
				`Downloading PHP ${ RecommendedPHPVersion } package for ${ platform }-${ arch }...`
			);
			fs.rmSync( bundledPhpBinaryRoot, { recursive: true, force: true } );
			await execAsync(
				`npx tsx ${ path.join(
					repoRoot,
					'scripts',
					'download-php-binary.ts'
				) } ${ RecommendedPHPVersion } ${ platform } ${ arch } --install-root ${ JSON.stringify(
					bundledPhpBinaryRoot
				) }`,
				{
					STUDIO_PHP_BINARY_DOWNLOAD_REQUIRED: '1',
				}
			);

			// On Windows, the bundled binary also serves as the AppExecutionAlias target.
			// AppX packages require AppExecutionAlias with an .exe target — batch files won't work.
			if ( platform === 'win32' ) {
				fs.copyFileSync( cliDest, path.join( __dirname, 'bin', 'studio-cli.exe' ) );
			}

			// Drop the cross-platform launcher file before forge copies bin/ as
			// extraResource. macOS/Linux builds don't need studio-cli.bat.
			if ( platform !== 'win32' ) {
				fs.rmSync( path.join( __dirname, 'bin', 'studio-cli.bat' ), { force: true } );
			}
		},
	},
};

export default config;
