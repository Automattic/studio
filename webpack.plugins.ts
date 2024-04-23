import path from 'path';
import { DefinePlugin } from 'webpack';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' ); // eslint-disable-line @typescript-eslint/no-var-requires

const siteServerProcessModulePath = path.resolve( __dirname, '.webpack/main/siteServerProcess.js' );

export const plugins: WebpackPluginInstance[] = [
	new ForkTsCheckerWebpackPlugin( {
		logger: 'webpack-infrastructure',
		issue: {
			exclude: {
				file: 'vendor/**/*',
			},
		},
	} ),
	new DefinePlugin( {
		SITE_SERVER_PROCESS_MODULE_PATH: JSON.stringify( siteServerProcessModulePath ),
	} ),
];
