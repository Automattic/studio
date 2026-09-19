import { defineConfig } from 'vite';

export default defineConfig( {
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
	server: {
		watch: {
			// Running jobs write thousands of files there, including captured .html pages
			// that would each reload the browser.
			ignored: [ '**/.data/**' ],
		},
	},
} );
