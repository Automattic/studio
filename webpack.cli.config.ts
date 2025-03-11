import path from 'path';
import { type Configuration } from 'webpack';
import { rules } from './webpack.rules';

const config: Configuration = {
	target: 'node',
	entry: './cli/index.ts',
	output: {
		filename: 'studio-cli.js',
		path: path.resolve( __dirname, 'dist/cli' ),
	},
	mode: 'production',
	devtool: 'source-map',
	module: {
		rules,
	},
	resolve: {
		extensions: [ '.js', '.ts', '.json' ],
		alias: {
			src: path.resolve( __dirname, 'src/' ),
		},
	},
	optimization: {
		minimize: false, // Better for Node.js CLI tools
	},
};

export default config; 