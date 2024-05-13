import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { type Configuration, DefinePlugin } from 'webpack';
import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

// Extra entries are bundled separately from the main bundle. They are primarily used
// for worker threads and forked processes, which need to be loaded independently.
const extraEntries = [
	{
		name: 'siteServerProcess',
		path: './src/lib/site-server-process-child.ts',
		exportName: 'SITE_SERVER_PROCESS_MODULE_PATH',
	},
];

export default function mainConfig( _env: unknown, args: Record< string, unknown > ) {
	const isProduction = args.mode === 'production';

	// Generates the necessary plugins to expose the module path of extra entries.
	const definePlugins = extraEntries.map( ( entry ) => {
		// The path calculation is based on how the Forge's webpack plugin generates the path for Electron files.
		// Reference: https://github.com/electron/forge/blob/b298b2967bdc79bdc4e09681ea1ccc46a371635a/packages/plugin/webpack/src/WebpackConfig.ts#L113-L140
		const modulePath = isProduction
			? `require('path').resolve(__dirname, '..', 'main', '${ entry.name }.js')`
			: JSON.stringify( path.resolve( __dirname, `.webpack/main/${ entry.name }.js` ) );
		return new DefinePlugin( {
			[ entry.exportName ]: modulePath,
		} );
	} );

	return {
		...mainBaseConfig,
		plugins: [ ...( mainBaseConfig.plugins || [] ), ...definePlugins ],
	};
}

export const mainBaseConfig: Configuration = {
	entry: {
		// This is the main entry point for your application, it's the first file
		// that runs in the main process.
		index: './src/index.ts',
		// Inject extra entries into the webpack configuration.
		// These entries are primarily used for worker threads and forked processes.
		...extraEntries.reduce( ( accum, entry ) => {
			return { ...accum, [ entry.name ]: entry.path };
		}, {} ),
	},
	output: {
		filename: '[name].js',
	},
	// Put your normal webpack config below here
	devtool: 'source-map',
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
		new CopyWebpackPlugin( {
			patterns: [
				// Copy about-menu.html into the main output directory
				{
					from: path.resolve( __dirname, 'src/about-menu/about-menu.html' ),
					to: path.resolve( __dirname, '.webpack/main/menu' ),
				},
				{
					from: path.resolve( __dirname, 'src/about-menu/studio-app-icon.png' ),
					to: path.resolve( __dirname, '.webpack/main/menu' ),
				},
			],
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
