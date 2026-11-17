import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import zlib from 'zlib';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { globSync } from 'glob';
import * as tar from 'tar';
import { PROTOCOL_PREFIX } from '../../packages/common/constants';
import { DEFAULT_LOCALE } from '../../packages/common/lib/locale';
import { RecommendedPHPVersion } from '../../packages/common/types/php-versions';
import { dmgLayout } from '../../scripts/dmg-layout';
import { buildSpotlightNative } from './native/build';
import { matchSupportedLocale } from './src/lib/match-supported-locale';
import { squirrelWindowsSign, windowsSign } from './windowsSign';
import type { ForgeConfig } from '@electron-forge/shared-types';

const repoRoot = path.resolve( __dirname, '../..' );
const bundledPhpBinaryRoot = path.join( __dirname, 'php-bin' );
// The name users read. productName stays "Studio" because it names the app
// bundle, executable, DMG and log and data folders that releases rely on.
const displayName = 'WordPress Studio';

const execFileAsync = promisify( execFile );

// English, and the Electron locales Studio shows in a translation, keep Chromium's locale pack.
function keepsOwnLocalePack( locale: string ): boolean {
	return (
		new Intl.Locale( locale ).language === 'en' || matchSupportedLocale( locale ) !== DEFAULT_LOCALE
	);
}

// The Electron locales Studio shows in English carry the English locale pack in place of their own.
// Every locale keeps a pack, so Chromium still picks the app locale from the languages the system
// lists, and with it Studio's language, and shows its own strings for these locales in English. The
// pack is a link to the English one where the package formats carry links, and a copy on Windows,
// where they don't.
function useEnglishLocalePacks( electronPath: string, platform: string ) {
	if ( platform === 'darwin' ) {
		const [ resources ] = globSync(
			'*.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
			{ cwd: electronPath, absolute: true }
		);
		for ( const pack of globSync( '*.lproj/locale.pak', { cwd: resources } ) ) {
			// Folder names use `_` for `-`, and some carry a grammatical gender: `es_419_FEMININE.lproj`.
			const [ , locale, gender = '' ] =
				/^(.+?)(_FEMININE|_MASCULINE|_NEUTER)?\.lproj[\\/]/.exec( pack ) ?? [];
			if ( locale && ! keepsOwnLocalePack( locale.replace( /_/g, '-' ) ) ) {
				const packPath = path.join( resources, pack );
				fs.rmSync( packPath );
				fs.symlinkSync( `../en${ gender }.lproj/locale.pak`, packPath );
			}
		}
		return;
	}

	const locales = path.join( electronPath, 'locales' );
	for ( const pack of fs.readdirSync( locales ) ) {
		if ( pack.endsWith( '.pak' ) && ! keepsOwnLocalePack( path.basename( pack, '.pak' ) ) ) {
			const packPath = path.join( locales, pack );
			fs.rmSync( packPath );
			if ( platform === 'win32' ) {
				fs.copyFileSync( path.join( locales, 'en-US.pak' ), packPath );
			} else {
				fs.symlinkSync( 'en-US.pak', packPath );
			}
		}
	}
}

// The signing identity @electron/osx-sign picks for the app: the first valid Developer ID
// Application identity in the keychain search list.
async function findDeveloperIdIdentity(): Promise< string | undefined > {
	const { stdout } = await execFileAsync( 'security', [ 'find-identity', '-v' ] );
	return /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application:/m.exec( stdout )?.[ 1 ];
}

function isMachO( filePath: string ): boolean {
	const fd = fs.openSync( filePath, 'r' );
	try {
		const header = Buffer.alloc( 4 );
		if ( fs.readSync( fd, header, 0, 4, 0 ) !== 4 ) {
			return false;
		}
		return [ 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe ].includes(
			header.readUInt32BE( 0 )
		);
	} finally {
		fs.closeSync( fd );
	}
}

// The app's signing can't reach into the PHP archive, so the packaging signs PHP's executables
// before compressing them, the way the app's signing signs the app's own: with the Developer ID
// identity, the hardened runtime and @electron/osx-sign's default entitlements on macOS, and with
// the Windows signing hook. Builds without a signing identity leave them as downloaded.
async function signPhpPackage( packageDir: string, platform: string ) {
	const files = globSync( '**/*', { cwd: packageDir, absolute: true, nodir: true } );
	if ( platform === 'darwin' ) {
		const identity = await findDeveloperIdIdentity();
		if ( ! identity ) {
			console.log( 'No Developer ID Application identity found, skipping PHP signing ...' );
			return;
		}
		for ( const file of files.filter( isMachO ) ) {
			await execFileAsync( 'codesign', [
				'--sign',
				identity,
				'--force',
				'--timestamp',
				'--options',
				'runtime',
				'--entitlements',
				path.join( __dirname, 'entitlements', 'php.plist' ),
				file,
			] );
		}
	} else if ( platform === 'win32' && windowsSign?.hookModulePath ) {
		const { default: signFile } = ( await import(
			pathToFileURL( windowsSign.hookModulePath ).href
		) ) as { default: ( file: string ) => void | Promise< void > };
		const portableExecutables = files.filter( ( candidate ) =>
			/\.(exe|dll|sys|efi|scr|node)$/i.test( candidate )
		);
		for ( const file of portableExecutables ) {
			await signFile( file );
		}
	}
}

// A brotli-compressed tarball, which the CLI unpacks on first run with what it already ships.
async function compressPhpPackage( packageDir: string, archivePath: string ) {
	await pipeline(
		tar.c( { cwd: packageDir, portable: true }, fs.readdirSync( packageDir ) ),
		zlib.createBrotliCompress( {
			params: {
				[ zlib.constants.BROTLI_PARAM_QUALITY ]: zlib.constants.BROTLI_MAX_QUALITY,
				[ zlib.constants.BROTLI_PARAM_LGWIN ]: zlib.constants.BROTLI_MAX_WINDOW_BITS,
			},
		} ),
		fs.createWriteStream( archivePath )
	);
}

const config: ForgeConfig = {
	packagerConfig: {
		asar: { unpack: 'native/*.node' },
		// macOS only lets an app handle URL schemes its Info.plist declares.
		protocols: [ { name: 'Studio', schemes: [ PROTOCOL_PREFIX ] } ],
		extendInfo: {
			NSUserActivityTypes: [ 'com.apple.corespotlightitem' ],
			MDItemKeywords: 'WordPress, WordPress Studio, WP, local WordPress development',
			// Finder, the Dock and the menu bar then take the name from the
			// InfoPlist.strings written below.
			LSHasLocalizedDisplayName: true,
		},
		afterExtract: [
			async ( { buildPath, platform } ) => {
				useEnglishLocalePacks( buildPath, platform );
			},
		],
		afterCopy: [
			async ( { buildPath, platform, arch } ) => {
				if ( platform === 'darwin' ) {
					buildSpotlightNative( arch, path.join( buildPath, 'native', 'spotlight.node' ) );
				}
			},
		],
		afterCopyExtraResources: [
			async ( { buildPath, platform } ) => {
				if ( platform !== 'darwin' ) {
					return;
				}
				const strings = `CFBundleDisplayName = "${ displayName }";\nCFBundleName = "${ displayName }";\n`;
				const localizations = globSync( '*.app/Contents/Resources/*.lproj', {
					cwd: buildPath,
					absolute: true,
				} );
				for ( const localization of localizations ) {
					fs.writeFileSync( path.join( localization, 'InfoPlist.strings' ), strings );
				}
			},
		],
		win32metadata: { FileDescription: displayName },
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
			/^\/native/,
			/^\/installers/,
			// Build-time helpers
			/^\/windowsSign\.ts$/,
			// Config files
			/^\/tsconfig\./,
			/^\/vitest\./,
			/^\/forge\./,
			/^\/electron\./,
			/^\/.*\.md$/,
			/^\/.*\.txt$/,
			/^\/.*\.log$/,
			// Source maps are uploaded to Sentry at build time and not needed at runtime.
			/\.map$/,
			// Type declarations only serve type checking.
			/\.d\.[cm]?ts$/,
			// Build tools @sentry/node depends on only for its bundler plugins, which the main
			// process never loads.
			/\/node_modules\/(sentry|@sentry\/bundler-plugins|oxc-parser|@oxc-parser|@oxc-project)(\/|$)/,
			// Resources copied separately via extraResource
			/^\/assets/,
			/^\/bin/,
			/^\/php-bin/,
		],
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				// Display name for app launchers and stores.
				productName: displayName,
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
				// Names the uninstall entry; shortcuts take the exe's ProductName.
				title: displayName,
				loadingGif: path.join( __dirname, 'installers', 'loading.gif' ),
				setupIcon: path.join( __dirname, 'assets', 'studio-app-icon.ico' ),
				// This icon is shown in Control Panel -> Programs and Features
				// Windows Explorer caches the icon agressively; use the cache busting param when necessary.
				iconUrl: 'https://s0.wp.com/i/studio-app/studio-app-icon.ico?v=3',

				setupExe: 'studio-setup.exe',

				// Sign via the custom Azure Trusted Signing hook (signtool, SHA256-only).
				// Undefined when SIGN_WINDOWS_BUILD isn't set (e.g. package-only jobs), leaving the build unsigned.
				...( squirrelWindowsSign ? { windowsSign: squirrelWindowsSign } : {} ),
			},
			[ 'win32' ]
		),
		...( process.env.SKIP_DMG
			? []
			: [
					new MakerDMG(
						{
							title: displayName,
							icon: path.join( __dirname, 'assets', 'studio-app-icon.icns' ),
							iconSize: dmgLayout.iconSize,
							background: path.join( __dirname, 'assets', 'dmg-background.png' ),
							contents: [
								{
									...dmgLayout.app,
									type: 'file',
									path: `${ process.cwd() }/out/Studio-darwin-${
										process.env.FILE_ARCHITECTURE || 'arm64'
									}/Studio.app`,
								},
								{ ...dmgLayout.applications, type: 'link', path: '/Applications' },
								{ x: 900, y: 900, type: 'position', path: '.background' },
								{ x: 900, y: 900, type: 'position', path: '.DS_Store' },
								{ x: 900, y: 900, type: 'position', path: '.Trashes' },
								{ x: 900, y: 900, type: 'position', path: '.VolumeIcon.icns' },
							],
							additionalDMGOptions: {
								window: {
									size: {
										width: dmgLayout.width,
										height: dmgLayout.height,
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

			// Strip AI provider SDKs Studio never loads (Mistral, AWS Bedrock). pi-ai loads them
			// lazily and Studio doesn't expose them, so they're dead weight — and @mistralai's
			// ~200-char generated filenames, nested under pi-coding-agent, blow past Windows'
			// 260-char path limit and crash the Squirrel maker.
			console.log( 'Removing unused AI provider SDKs from CLI bundle...' );
			const unusedProviderPatterns = [
				'{@mistralai,@aws-sdk,@aws-crypto,@smithy}/',
				'**/node_modules/{@mistralai,@aws-sdk,@aws-crypto,@smithy}/',
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
				'node',
				'--experimental-strip-types',
				path.join( repoRoot, 'scripts', 'download-node-binary.ts' ),
				platform,
				arch,
			] );

			console.log(
				`Downloading PHP ${ RecommendedPHPVersion } package for ${ platform }-${ arch }...`
			);
			fs.rmSync( bundledPhpBinaryRoot, { recursive: true, force: true } );
			const phpDownloadRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-package-' ) );
			try {
				await execAsync(
					[
						'node',
						'--experimental-strip-types',
						path.join( repoRoot, 'scripts', 'download-php-binary.ts' ),
						RecommendedPHPVersion,
						platform,
						arch,
						'--install-root',
						phpDownloadRoot,
					],
					{
						STUDIO_PHP_BINARY_DOWNLOAD_REQUIRED: '1',
					}
				);
				// The CLI unpacks the package on first run into `<config>/php-bin/<package-id>/`.
				const [ packageId ] = fs.readdirSync( phpDownloadRoot );
				const packageDir = path.join( phpDownloadRoot, packageId );
				await signPhpPackage( packageDir, platform );
				console.log( `Compressing PHP package ${ packageId } ...` );
				fs.mkdirSync( bundledPhpBinaryRoot );
				await compressPhpPackage(
					packageDir,
					path.join( bundledPhpBinaryRoot, `${ packageId }.tar.br` )
				);
			} finally {
				fs.rmSync( phpDownloadRoot, { recursive: true, force: true } );
			}
		},
	},
};

export default config;
