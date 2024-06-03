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

rules.push( {
	test: /\.(sc|sa)ss$/,
	use: [
		{ loader: MiniCssExtractPlugin.loader },
		{ loader: 'css-loader' },
		{
			loader: require.resolve( 'sass-loader' ),
			options: {
				sourceMap: true,
			},
		},
	],
} );

plugins.push( new MiniCssExtractPlugin() );

// Encode imported images as base64 data URIs
rules.push( {
	test: /\.(png|jpe?g|gif|svg)$/i,
	type: 'asset/inline',
} );

export const rendererConfig: Configuration = {
	devtool: 'source-map',
	module: {
		rules,
	},
	plugins,
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.scss', '.css' ],
	},
	externals: {
		react: 'React',
		'react-dom': 'ReactDOM',
	},
};
