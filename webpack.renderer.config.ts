import MiniCssExtractPlugin from 'mini-css-extract-plugin';
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

export const rendererConfig: Configuration = {
	module: {
		rules,
	},
	plugins,
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.css' ],
	},
};
