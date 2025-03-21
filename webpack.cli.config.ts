import path from 'path';
import { type Configuration } from 'webpack';
import { rules } from './webpack.rules';

const config: Configuration = {
	target: 'node',
	entry: './cli/index.ts',
	output: {
		filename: '[name].js',
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
		},
	},
	optimization: {
		minimize: false,
		splitChunks: false,
	},
};

export default config;
