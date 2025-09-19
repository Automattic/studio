import { resolve } from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { existsSync } from 'fs';

const yargsLocalesPath = resolve( __dirname, 'node_modules/yargs/locales' );

export default defineConfig( {
	plugins: [
		...( existsSync( yargsLocalesPath )
			? [
					viteStaticCopy( {
						targets: [
							{
								src: 'node_modules/yargs/locales/*',
								dest: '../locales',
							},
						],
					} ),
			  ]
			: [] ),
	],
	build: {
		lib: {
			entry: resolve( __dirname, 'cli/index.ts' ),
			name: 'StudioCLI',
			fileName: 'main',
			formats: [ 'cjs' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rollupOptions: {
			external: [
				/^node:/,
				/^(path|fs|os|child_process|crypto|http|https|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants)$/,
				'superagent',
				'archiver',
			],
			output: {
				format: 'cjs',
				entryFileNames: 'main.js',
			},
		},
		sourcemap: true,
		minify: false,
	},
	resolve: {
		alias: {
			cli: resolve( __dirname, 'cli' ),
			src: resolve( __dirname, 'src' ),
			vendor: resolve( __dirname, 'vendor' ),
			common: resolve( __dirname, 'common' ),
		},
		conditions: [ 'node' ],
	},
} );
