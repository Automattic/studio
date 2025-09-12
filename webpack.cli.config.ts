import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { type Configuration, DefinePlugin } from 'webpack';
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
		new DefinePlugin( {
			// Polyfill import.meta.dirname and import.meta.filename for @php-wasm/node compatibility
			'import.meta.dirname': '__dirname',
			'import.meta.filename': '__filename',
		} ),
		new CopyWebpackPlugin( {
			patterns: [
				// Copy yargs locales from node_modules to dist/cli/locales so they can be used by the CLI at runtime
				{
					from: path.resolve( __dirname, 'node_modules/yargs/locales' ),
					to: path.resolve( __dirname, 'dist', 'locales' ),
				},
				// Copy ICU data file for @php-wasm/node internationalization support (if needed by CLI)
				{
					from: path.resolve( __dirname, 'node_modules/@php-wasm/node/shared/icudt74l.dat' ),
					to: path.resolve( __dirname, 'dist', 'cli', 'shared', 'icudt74l.dat' ),
				},
			],
		} ),
	],
};

export default config;
