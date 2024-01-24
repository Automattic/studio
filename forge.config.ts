// When ts-node runs this file it doesn't seem to use our tsconfig.json project
// settings, so we need to reference custom package definitions manually.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./src/custom-package-definitions.d.ts" />

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import ForgeExternalsPlugin from '@timfish/forge-externals-plugin';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: [ './wp-files' ],
		executableName: process.platform !== 'darwin' ? 'local-environment' : undefined,
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP( {}, [ 'darwin' ] ),
		new MakerDMG( {}, [ 'darwin' ] ),
		new MakerDeb( {
			options: {
				genericName: 'WordPress Local Dev',
				categories: [ 'Utility' ],
				name: 'local-environment',
			},
		} ),
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
			...( process.env.PORT && {
				port: parseInt( process.env.PORT, 10 ),
			} ),
		} ),
		// This plugin bundles the externals defined in the Webpack config file.
		new ForgeExternalsPlugin( { externals: Object.keys( mainConfig.externals ?? {} ) } ),
	],
};

export default config;
