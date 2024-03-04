// When ts-node runs this file it doesn't seem to use our tsconfig.json project
// settings, so we need to reference custom package definitions manually.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./src/custom-package-definitions.d.ts" />

import fs from 'fs';
import path from 'path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import ForgeExternalsPlugin from '@timfish/forge-externals-plugin';
import packageJson from './package.json';
import { isErrnoException } from './src/lib/is-errno-exception';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import type { ForgeConfig } from '@electron-forge/shared-types';

const { version } = packageJson;
const currentCommit = process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT;
const isDevBuild = Boolean( process.env.DEV_BUILD );

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [ './wp-files', './assets' ],
		executableName: process.platform === 'linux' ? 'studio' : undefined,
		icon: './assets/studio-app-icon',
		osxSign: {},
		appVersion:
			isDevBuild && currentCommit
				? `${ version.split( '-' )[ 0 ] }-dev.${ currentCommit }`
				: version,
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
		new MakerSquirrel(
			{
				loadingGif: './installers/loading.gif',
				setupIcon: './assets/studio-app-icon.ico',
				iconUrl: 'https://s0.wp.com/i/studio-app/studio-app-icon.ico', // This icon is shown in Control Panel -> Programs and Features
			},
			[ 'win32' ]
		),
		...( process.env.SKIP_DMG
			? []
			: [
					new MakerDMG(
						{
							icon: './assets/studio-app-icon.icns',
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
						html: './src/index.html',
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
		new ForgeExternalsPlugin( { externals: Object.keys( mainConfig.externals ?? {} ) } ),
	],
	hooks: {
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
