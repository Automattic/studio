import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig( {
	plugins: [ react(), viteSingleFile() ],
	root: __dirname,
	build: {
		outDir: 'dist',
		target: 'chrome120',
		minify: 'esbuild',
	},
} );
