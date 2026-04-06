import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dsTokenFallbacks from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import { resolve } from 'path';

export default defineConfig( ( { mode } ) => {
	const isElectron = mode === 'electron';

	return {
		plugins: [
			react(),
			dsTokenFallbacks(),
		],
		css: {
			postcss: {
				plugins: [ dsTokenFallbacksPostcss ],
			},
		},
		resolve: {
			alias: {
				'@': resolve( __dirname, 'src' ),
			},
		},
		define: {
			__IS_ELECTRON__: JSON.stringify( isElectron ),
		},
		server: {
			port: 5200,
		},
		build: {
			outDir: isElectron ? 'dist/electron' : 'dist/web',
			rollupOptions: {
				input: resolve( __dirname, 'index.html' ),
			},
		},
	};
} );
