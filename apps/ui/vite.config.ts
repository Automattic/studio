import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dsTokenFallbacks from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import { resolve } from 'path';

export default defineConfig( {
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
	server: {
		port: 5200,
	},
	build: {
		outDir: 'dist',
		rollupOptions: {
			input: resolve( __dirname, 'index.html' ),
		},
	},
} );
