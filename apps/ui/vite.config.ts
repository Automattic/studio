import { defineConfig, type Plugin } from 'vite';
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

// Web target (`STUDIO_TARGET=web`) builds a standalone browser app wired to the
// HTTP/SSE web connector. It uses a separate entry/output/port so the default
// Electron-renderer build (`dist/`, port 5200) stays byte-for-byte unchanged.
const isWeb = process.env.STUDIO_TARGET === 'web';

// In dev, Vite serves the root `index.html` (which loads the Electron entry,
// `main.tsx`) for every SPA navigation, regardless of `build` input options.
// Serve `index.web.html` instead for any document navigation (`/`, `/sites`,
// `/sessions/:id`, …) so the web entry + web connector load and client-side
// routing/refresh works. Module and asset requests pass through untouched.
const webDevEntryPlugin: Plugin = {
	name: 'studio-web-dev-entry',
	apply: 'serve',
	configureServer( server ) {
		server.middlewares.use( ( req, _res, next ) => {
			const accept = req.headers.accept ?? '';
			const [ pathname ] = ( req.url ?? '' ).split( '?' );
			const isInternal =
				pathname.startsWith( '/@' ) ||
				pathname.startsWith( '/src/' ) ||
				pathname.startsWith( '/node_modules/' ) ||
				pathname.includes( '.' );
			if ( accept.includes( 'text/html' ) && ! isInternal ) {
				req.url = '/index.web.html';
			}
			next();
		} );
	},
};

export default defineConfig( {
	plugins: [ react(), dsTokenFallbacks(), ...( isWeb ? [ webDevEntryPlugin ] : [] ) ],
	css: {
		postcss: {
			plugins: [ dsTokenFallbacksPostcss ],
		},
	},
	resolve: {
		alias: {
			'@': resolve( __dirname, 'src' ),
			// `@wp-playground/blueprints` ships the schema validator as a sibling
			// module that isn't listed in the package's `exports` map. Shared
			// helpers in @studio/common (blueprint-validation.ts) import it via
			// this subpath, so map it through explicitly — matches the apps/cli
			// and apps/studio vite configs.
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		dedupe: directDeps,
	},
	optimizeDeps: {
		include: directDeps,
	},
	server: {
		port: isWeb ? 5300 : 5200,
	},
	build: {
		outDir: isWeb ? 'dist-web' : 'dist',
		rolldownOptions: {
			input: resolve( __dirname, isWeb ? 'index.web.html' : 'index.html' ),
			onwarn( warning, defaultHandler ) {
				// These dynamic imports break a circular dependency in ui-desks
				// (definition.ts → widget-context/editor-commands → registry → definition.ts)
				// and cannot be used for code-splitting because the modules are also
				// statically imported elsewhere. Suppress the noise.
				if ( warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT' ) {
					return;
				}
				defaultHandler( warning );
			},
		},
	},
} );
