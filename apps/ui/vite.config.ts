import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dsTokenFallbacks from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire( import.meta.url );
const pkg = require( './package.json' ) as {
	dependencies?: Record< string, string >;
};
// Dedupe + pre-bundle every direct dep so packages with module-scoped state
// (React's hooks dispatcher, @wordpress/private-apis' lock/unlock registry,
// etc.) can't accidentally resolve to two instances. Workspace packages
// (`file:`) are skipped because Vite pre-bundling expects a resolvable
// package entry and our workspace packages ship subpaths only.
const directDeps = Object.entries( pkg.dependencies ?? {} )
	.filter( ( [ , version ] ) => ! version.startsWith( 'file:' ) )
	.map( ( [ name ] ) => name );

export default defineConfig( {
	plugins: [ react(), dsTokenFallbacks() ],
	css: {
		postcss: {
			plugins: [ dsTokenFallbacksPostcss ],
		},
	},
	resolve: {
		alias: {
			'@': resolve( __dirname, 'src' ),
		},
		dedupe: directDeps,
	},
	optimizeDeps: {
		include: directDeps,
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
