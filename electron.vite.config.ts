import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';

export default defineConfig( {
	main: {
		plugins: [ externalizeDepsPlugin() ],
		resolve: {
			alias: {
				src: resolve( 'src' ),
				common: resolve( 'common' ),
				cli: resolve( 'cli' ),
				vendor: resolve( 'vendor' ),
			},
		},
		define: {
			MAIN_WINDOW_WEBPACK_ENTRY: JSON.stringify( 'http://localhost:5173' ),
			MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(
				resolve( __dirname, 'out/preload/preload.js' )
			),
			COMMIT_HASH: JSON.stringify(
				process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT ?? 'dev'
			),
			// Process module paths for forked processes and worker threads
			SITE_SERVER_PROCESS_MODULE_PATH: JSON.stringify(
				resolve( __dirname, 'out/main/siteServerProcess.js' )
			),
			WP_CLI_PROCESS_MODULE_PATH: JSON.stringify(
				resolve( __dirname, 'out/main/wpCliProcess.js' )
			),
			PLAYGROUND_SERVER_PROCESS_MODULE_PATH: JSON.stringify(
				resolve( __dirname, 'out/main/playgroundServerProcess.js' )
			),
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve( __dirname, 'src/index.ts' ),
					siteServerProcess: resolve(
						__dirname,
						'src/lib/wordpress-provider/wp-now/site-server-process-child.ts'
					),
					wpCliProcess: resolve( __dirname, 'src/lib/wp-cli-process-child.ts' ),
					playgroundServerProcess: resolve(
						__dirname,
						'src/lib/wordpress-provider/playground-cli/playground-server-process-child.ts'
					),
				},
				output: {
					entryFileNames: '[name].js',
				},
				external: [ '@php-wasm/node', '@php-wasm/web' ],
			},
		},
	},
	preload: {
		plugins: [ externalizeDepsPlugin( { exclude: [ '@sentry/electron' ] } ) ],
		build: {
			lib: {
				entry: resolve( __dirname, 'src/preload.ts' ),
			},
		},
	},
	renderer: {
		root: '.',
		resolve: {
			alias: {
				src: resolve( 'src' ),
				common: resolve( 'common' ),
				cli: resolve( 'cli' ),
				vendor: resolve( 'vendor' ),
			},
		},
		plugins: [
			react(),
			topLevelAwait(),
			wasm(),
			viteStaticCopy( {
				targets: [
					{
						src: resolve( __dirname, 'node_modules/@wordpress/components/build-style/style.css' ),
						dest: 'main_window/styles',
						rename: 'wordpress-components-style.css',
					},
					{
						src: resolve(
							__dirname,
							'node_modules/@wordpress/components/build-style/style-rtl.css'
						),
						dest: 'main_window/styles',
						rename: 'wordpress-components-style-rtl.css',
					},
				],
			} ),
		],
		css: {
			// Ensure CSS injection order is preserved - WordPress styles first, then custom styles
			devSourcemap: true,
			postcss: './postcss.config.js',
		},
		assetsInclude: [ '**/*.riv' ],
		optimizeDeps: {
			include: [ '@wordpress/i18n', '@rive-app/react-canvas', '@rive-app/canvas' ],
			esbuildOptions: {
				sourcemap: false,
			},
		},
		server: {
			fs: {
				allow: [ '..' ],
			},
		},
		build: {
			rollupOptions: {
				input: resolve( __dirname, 'index.html' ),
				output: {
					// Extract CSS into separate files (like Webpack's MiniCssExtractPlugin)
					assetFileNames: (assetInfo) => {
						if (assetInfo.name && assetInfo.name.endsWith('.css')) {
							return 'assets/[name]-[hash][extname]';
						}
						return 'assets/[name]-[hash][extname]';
					},
				},
			},
			// Force CSS extraction instead of inlining
			cssCodeSplit: true,
		},
	},
} );
