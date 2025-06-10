import path from 'path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';
import type { Configuration } from 'webpack';

rules.push( {
	test: /\.css$/,
	use: [
		{ loader: MiniCssExtractPlugin.loader },
		{ loader: 'css-loader' },
		{ loader: 'postcss-loader' },
	],
} );

plugins.push( new MiniCssExtractPlugin() );

plugins.push(
	new CopyWebpackPlugin( {
		patterns: [
			// Copy @wordpress/components stylesheets to the renderer directory
			{
				from: path.resolve( __dirname, 'node_modules/@wordpress/components/build-style/style.css' ),
				to:  path.resolve( __dirname, '.webpack/renderer/main_window/styles/wordpress-components-style.css'),
			},
			{
				from: path.resolve( __dirname, 'node_modules/@wordpress/components/build-style/style-rtl.css' ),
				to: path.resolve( __dirname, '.webpack/renderer/main_window/styles/wordpress-components-style-rtl.css' ),
			},
		],
	} )
);

// Encode imported images as base64 data URIs
rules.push( {
	test: /\.(png|jpe?g|gif|svg)$/i,
	type: 'asset/inline',
} );

// Exports a URL for Rive and WASM files
// This is mainly used in Rive animations.
rules.push( {
	test: /\.(riv|wasm)$/i,
	type: 'asset/resource',
} );

export const rendererConfig: Configuration = {
	devtool: 'source-map',
	module: {
		rules,
	},
	plugins,
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.css' ],
		alias: {
			cli: path.join( __dirname, 'cli/' ),
			src: path.resolve( __dirname, 'src/' ),
			vendor: path.resolve( __dirname, 'vendor/' ),
			common: path.resolve( __dirname, 'common/' ),
		},
	},
};
