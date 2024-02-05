// When ts-node runs this file it doesn't seem to use our tsconfig.json project
// settings, so we need to reference custom package definitions manually.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./src/custom-package-definitions.d.ts" />

import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import ForgeExternalsPlugin from '@timfish/forge-externals-plugin';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [ './wp-files' ],
		executableName: process.platform === 'linux' ? 'local-environment' : undefined,
		osxSign: {},
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				genericName: 'WordPress Local Dev',
				categories: [ 'Utility' ],
				name: 'local-environment',
			},
		} ),
		new MakerSquirrel(
			{
				loadingGif: './installers/loading.gif',
			},
			[ 'win32' ]
		),
		...( process.env.SKIP_DMG ? [] : [ new MakerDMG( {}, [ 'darwin' ] ) ] ),
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
};

export default config;
