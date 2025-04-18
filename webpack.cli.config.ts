import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { type Configuration } from 'webpack';
import { rules } from './webpack.rules';

const config: Configuration = {
	target: 'node',
	entry: './cli/index.ts',
	output: {
		filename: 'main.js',
		path: path.join( __dirname, 'dist', 'cli' ),
		libraryTarget: 'commonjs2',
		chunkFormat: 'commonjs',
	},
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
	devtool: 'source-map',
	module: {
		rules,
	},
	resolve: {
		extensions: [ '.js', '.ts', '.json' ],
		alias: {
			cli: path.join( __dirname, 'cli' ),
			src: path.resolve( __dirname, 'src/' ),
			vendor: path.resolve( __dirname, 'vendor/' ),
			common: path.resolve( __dirname, 'common/' ),
		},
	},
	optimization: {
		minimize: false,
		splitChunks: false,
	},
	stats: 'minimal',
	plugins: [
		new CopyWebpackPlugin( {
			patterns: [
				{
					from: path.resolve( __dirname, 'node_modules/yargs/locales' ),
					to: path.resolve( __dirname, 'dist', 'locales' ),
				},
			],
		} ),
	],
};

export default config;
