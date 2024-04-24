import { type Configuration, DefinePlugin } from 'webpack';
import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

export const mainConfig: Configuration = {
	/**
	 * This is the main entry point for your application, it's the first file
	 * that runs in the main process.
	 */
	entry: {
		index: './src/index.ts',
		siteServerProcess: './src/lib/site-server-process-child.ts',
	},
	output: {
		filename: '[name].js',
	},
	// Put your normal webpack config below here
	module: {
		rules,
	},
	plugins: [
		...plugins,
		new DefinePlugin( {
			COMMIT_HASH: JSON.stringify(
				process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT ?? undefined
			),
		} ),
	],
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.css', '.json' ],
	},
	externals: {
		// We need to add PHP Wasm as an external because it uses the __dirname
		// variable, and Webpack messes with it.
		'@php-wasm/node': '@php-wasm/node',
	},
};
