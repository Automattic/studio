import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs-extra';
import { type Configuration, DefinePlugin } from 'webpack';
import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

function getWasmDirs( dir: string ) {
	return fs
		.readdirSync( dir, { withFileTypes: true } )
		.filter( ( dirent: fs.Dirent ) => dirent.isDirectory() )
		.map( ( dirent: fs.Dirent ) => dirent.name )
		.filter( ( name: string ) => name !== 'node_modules' );
}

const phpWasmDir = path.resolve( __dirname, 'node_modules/@php-wasm/node' );
const wasmDirs = getWasmDirs( phpWasmDir );

// Extra entries are bundled separately from the main bundle. They are primarily used
// for worker threads and forked processes, which need to be loaded independently.
const extraEntries = [
	{
		name: 'siteServerProcess',
		path: './src/lib/wordpress-provider/wp-now/site-server-process-child.ts',
		exportName: 'SITE_SERVER_PROCESS_MODULE_PATH',
	},
	{
		name: 'wpCliProcess',
		path: './src/lib/wp-cli-process-child.ts',
		exportName: 'WP_CLI_PROCESS_MODULE_PATH',
	},
	{
		name: 'playgroundServerProcess',
		path: './src/lib/wordpress-provider/playground-cli/playground-server-process-child.ts',
		exportName: 'PLAYGROUND_SERVER_PROCESS_MODULE_PATH',
	},
	// Skip building worker threads when SKIP_WORKER_THREAD_BUILD is set (performance tests)
	// Otherwise build them (needed for /Applications/ deployment)
	...( ! process.env.SKIP_WORKER_THREAD_BUILD
		? [
				{
					name: 'worker-thread-v1-BTJIbQLy',
					path: './node_modules/@wp-playground/cli/worker-thread-v1-BTJIbQLy.js',
					exportName: null,
				},
				{
					name: 'worker-thread-v2-BgOQY8w7',
					path: './node_modules/@wp-playground/cli/worker-thread-v2-BgOQY8w7.js',
					exportName: null,
				},
		  ]
		: [] ),
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

	// Only use custom loader when building worker threads (not when copying them)
	const useCustomLoader = ! process.env.SKIP_WORKER_THREAD_BUILD;

	return {
		...mainBaseConfig,
		module: {
			...mainBaseConfig.module,
			rules: useCustomLoader
				? [
						{
							test: /\.js$/,
							include: [
								path.resolve( __dirname, 'node_modules/@php-wasm/node' ),
								path.resolve( __dirname, 'node_modules/@wp-playground/cli' ),
							],
							use: [
								{
									loader: path.resolve(
										__dirname,
										'webpack-loaders/fix-import-meta-dirname-loader.js'
									),
								},
							],
						},
						...mainBaseConfig.module.rules,
				  ]
				: mainBaseConfig.module.rules,
		},
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

				...wasmDirs.map( ( dir ) => ( {
					from: path.join( phpWasmDir, dir ),
					to: path.resolve( __dirname, `.webpack/main/${ dir }` ),
				} ) ),
				// Copy @wp-playground/cli worker files when skipping webpack building (performance tests)
				...( process.env.SKIP_WORKER_THREAD_BUILD
					? [
							{
								from: path.resolve( __dirname, 'node_modules/@wp-playground/cli' ),
								to: path.resolve( __dirname, '.webpack/main' ),
								filter: ( resourcePath: string ) => {
									const fileName = path.basename( resourcePath );
									return fileName.startsWith( 'worker-thread-' );
								},
							},
					  ]
					: [] ),
			],
		} ),
	],
	resolve: {
		extensions: [ '.js', '.ts', '.jsx', '.tsx', '.css', '.json' ],
		alias: {
			cli: path.join( __dirname, 'cli/' ),
			src: path.resolve( __dirname, 'src/' ),
			vendor: path.resolve( __dirname, 'vendor/' ),
			common: path.resolve( __dirname, 'common/' ),
		},
	},
};
