import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs-extra';
import { type Configuration, type Compiler, type WebpackPluginInstance } from 'webpack';
import { rules } from './webpack.rules';

class PermissionsPlugin implements WebpackPluginInstance {
	apply( compiler: Compiler ): void {
		compiler.hooks.afterEmit.tap( 'PermissionsPlugin', () => {
			const binDir = path.resolve( __dirname, '.webpack/main/bin' );
			if ( fs.existsSync( binDir ) ) {
				fs.readdirSync( binDir ).forEach( ( file ) => {
					const filePath = path.join( binDir, file );
					fs.chmodSync( filePath, '755' ); // rwxr-xr-x
				} );
			}
		} );
	}
}

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
	plugins: [
		new PermissionsPlugin(),
		new CopyWebpackPlugin( {
			patterns: [
				{
					from: path.join( __dirname, 'bin' ),
					to: path.join( __dirname, 'dist', 'bin' ),
				},
			],
		} ),
	],
};

export default config;
