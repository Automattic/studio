import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';
import type { Configuration } from 'webpack';

export const mainConfig: Configuration = {
	/**
	 * This is the main entry point for your application, it's the first file
	 * that runs in the main process.
	 */
	entry: './src/index.ts',
	// Put your normal webpack config below here
	module: {
		rules,
	},
	plugins,
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.css', '.json' ],
	},
	externals: {
		// We need to add PHP Wasm as an external because it uses the __dirname
		// variable, and Webpack messes with it.
		'@php-wasm/node': '@php-wasm/node',
	},
};
