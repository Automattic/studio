import { dirname, join, resolve } from 'path';
import { normalizePath, type UserConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const yargsPath = dirname( require.resolve( 'yargs' ) );
const yargsLocalesPath = join( yargsPath, 'locales' );

export const nodeBuiltinExternals = [
	/^node:/,
	/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/,
	'fs/promises',
	'dns/promises',
];

export const yargsLocalesCopyPlugin = viteStaticCopy( {
	targets: [
		{
			src: normalizePath( join( yargsLocalesPath, '*' ) ),
			dest: '../locales',
		},
	],
} );

export const baseConfig: UserConfig = {
	build: {
		lib: {
			entry: {
				main: resolve( __dirname, 'index.ts' ),
				'process-manager-daemon': resolve( __dirname, 'process-manager-daemon.ts' ),
				'proxy-daemon': resolve( __dirname, 'proxy-daemon.ts' ),
				'wordpress-server-child': resolve( __dirname, 'wordpress-server-child.ts' ),
			},
			name: 'StudioCLI',
			formats: [ 'cjs' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rollupOptions: {
			output: {
				format: 'cjs',
				entryFileNames: '[name].js',
			},
		},
		commonjsOptions: {
			ignoreDynamicRequires: true,
		},
		sourcemap: true,
		minify: false,
	},
	resolve: {
		alias: {
			cli: resolve( __dirname, '.' ),
			'@studio/common': resolve( __dirname, '../../tools/common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
};
