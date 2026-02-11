import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { isErrnoException } from './common/lib/is-errno-exception';
import { exec } from 'child_process';
import { promisify } from 'util';
import { exec as pkgExec } from '@yao-pkg/pkg';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [ './wp-files', './assets', './bin', './dist/cli' ],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: './assets/studio-app-icon',
		osxSign: {
			optionsForFile: ( filePath ) => {
				// The bundled Node binary requires specific entitlements for V8 JIT compilation.
				// Without these, V8 crashes with SIGTRAP when trying to allocate executable memory.
				if ( filePath.endsWith( 'bin/node' ) ) {
					return {
						entitlements: path.join( __dirname, 'entitlements', 'node.plist' ),
					};
				}
				return {};
			},
		},
		ignore: [
			// Exclude major development directories
			/^\/\..*/, // All dotfiles and dot directories
			/^\/src/,
			/^\/common/,
			/^\/cli/,
			/^\/vendor/,
			/^\/fastlane/,
			/^\/docs/,
			/^\/e2e/,
			/^\/scripts/,
			/^\/packages/,
			/^\/patches/,
			/^\/metrics/,
			/^\/test-results/,
			/^\/webpack-loaders/,
			/^\/installers/,
			// Config files
			/^\/webpack\./,
			/^\/tsconfig\./,
			/^\/vitest\./,
			/^\/playwright\./,
			/^\/postcss\./,
			/^\/tailwind\./,
			/^\/forge\./,
			/^\/electron\./,
			/^\/index\.html$/,
			/^\/Gemfile/,
			/^\/.*\.md$/,
			/^\/.*\.txt$/,
			/^\/.*\.log$/,
			// External resources (shouldn't be in asar)
			/^\/assets/,
			/^\/bin/,
			/^\/wp-files/,
			/^\/dist\/cli/,
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
				loadingGif: './installers/loading.gif',
				setupIcon: './assets/studio-app-icon.ico',
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
							icon: 'assets/studio-app-icon.icns',
							background: 'assets/dmg-background.png',
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
			const zipPath = path.join( __dirname, 'wp-files', 'latest.zip' );
			try {
				fs.unlinkSync( zipPath );
			} catch ( err ) {
				if ( isErrnoException( err ) && err.code !== 'ENOENT' ) throw err;
			}

			console.log( 'Downloading language packs ...' );
			await execAsync( 'npm run download:language-packs' );

			console.log( 'Building CLI ...' );
			await execAsync( 'npm run cli:build' );

			console.log( `Downloading Node.js binary for ${ platform }-${ arch }...` );
			await execAsync( `npx ts-node ./scripts/download-node-binary.ts ${ platform } ${ arch }` );

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
