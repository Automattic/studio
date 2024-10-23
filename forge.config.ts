// When ts-node runs this file it doesn't seem to use our tsconfig.json project
// settings, so we need to reference custom package definitions manually.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./src/custom-package-definitions.d.ts" />

import fs from 'fs';
import path from 'path';
import { MakerAppX } from '@electron-forge/maker-appx';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import ForgeExternalsPlugin from '@timfish/forge-externals-plugin';
import ejs from 'ejs';
import { isErrnoException } from './src/lib/is-errno-exception';
import mainConfig, { mainBaseConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [ './wp-files', './assets', './bin' ],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: './assets/studio-app-icon',
		osxSign: {},
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				genericName: 'Studio by WordPress.com',
				categories: [ 'Utility' ],
				name: 'studio',
			},
		} ),
		new MakerAppX( {
			// This is the value that Simplenote uses, but it fails.
			// See https://buildkite.com/automattic/studio/builds/2930#0192b736-0faa-4762-af64-4b9d795a7410
			// publisher: 'CN=E2E5A157-746D-4B04-9116-ABE5CB928306',
			publisher:
				'CN=&quot;Automattic, Inc.&quot;, O=&quot;Automattic, Inc.&quot;, S=California, C=US',
			devCert: 'certificate.pfx',
			certPass: process.env.WINDOWS_CODE_SIGNING_CERT_PASSWORD,
			// Windows Store version numbers don't support semver beta tags.
			//
			// See implementation details at:
			// https://github.com/electron/forge/blob/4e7517c11f46b87a1e7b2a31b7c7ca39b0ee0a97/packages/maker/base/src/Maker.ts#L172-L179
			makeVersionWinStoreCompatible: true,
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
	plugins: [
		new AutoUnpackNativesPlugin( {} ),
		new WebpackPlugin( {
			mainConfig,
			renderer: {
				config: rendererConfig,
				entryPoints: [
					{
						html: './dist/index.html',
						js: './src/renderer.ts',
						name: 'main_window',
						preload: {
							js: './src/preload.ts',
						},
					},
				],
			},
			// By default the dev server uses the same port as calypso.localhost
			port: 3456,
		} ),
		// This plugin bundles the externals defined in the Webpack config file.
		new ForgeExternalsPlugin( { externals: Object.keys( mainBaseConfig.externals ?? {} ) } ),
	],
	hooks: {
		generateAssets: async () => {
			console.log( 'Building the HTML entry file ...' );

			const REACT_DEV_TOOLS =
				process.env.REACT_DEV_TOOLS === 'true' || process.env.REACT_DEV_TOOLS === '1';

			const ejsTemplate = fs.readFileSync( './src/index.ejs', 'utf8' );
			const data = { REACT_DEV_TOOLS };
			const renderedHtml = ejs.render( ejsTemplate, data );
			fs.mkdirSync( './dist', { recursive: true } );
			fs.writeFileSync( './dist/index.html', renderedHtml );
		},
		prePackage: async () => {
			console.log( "Ensuring latest WordPress zip isn't included in production build  ..." );

			const zipPath = path.join( __dirname, 'wp-files', 'latest.zip' );
			try {
				fs.unlinkSync( zipPath );
			} catch ( err ) {
				if ( isErrnoException( err ) && err.code !== 'ENOENT' ) throw err;
			}
		},
	},
};

export default config;
