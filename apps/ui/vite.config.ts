import { createRequire } from 'module';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import dsTokenFallbacks from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';
import { defineConfig, type Plugin } from 'vite';

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

// Browser targets build a standalone browser app wired to an HTTP/SSE connector
// instead of the Electron IPC bridge. Each uses a separate entry/output/port so
// the default Electron-renderer build (`dist/`, port 5200) stays byte-for-byte
// unchanged:
//   STUDIO_TARGET=hosted → index.hosted.html → dist-hosted, port 5300 (cloud)
//   STUDIO_TARGET=local  → index.local.html  → dist-local,  port 5400 (`studio ui`)
type BrowserTarget = 'hosted' | 'local';
const target = process.env.STUDIO_TARGET as BrowserTarget | undefined;
const isBrowser = target === 'hosted' || target === 'local';
const browserConfig: Record< BrowserTarget, { entry: string; outDir: string; port: number } > = {
	hosted: { entry: 'index.hosted.html', outDir: 'dist-hosted', port: 5300 },
	local: { entry: 'index.local.html', outDir: 'dist-local', port: 5400 },
};
const active = isBrowser ? browserConfig[ target as BrowserTarget ] : undefined;

// In dev, Vite serves the root `index.html` (which loads the Electron entry,
// `main.tsx`) for every SPA navigation, regardless of `build` input options.
// Serve the target's entry instead for any document navigation (`/`, `/sites`,
// `/sessions/:id`, …) so the browser entry + connector load and client-side
// routing/refresh works. Module and asset requests pass through untouched.
const browserDevEntryPlugin: Plugin = {
	name: 'studio-browser-dev-entry',
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
			if ( active && accept.includes( 'text/html' ) && ! isInternal ) {
				req.url = `/${ active.entry }`;
			}
			next();
		} );
	},
};

export default defineConfig( {
	plugins: [ react(), dsTokenFallbacks(), ...( isBrowser ? [ browserDevEntryPlugin ] : [] ) ],
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
		port: active?.port ?? 5200,
	},
	build: {
		outDir: active?.outDir ?? 'dist',
		rolldownOptions: {
			input: resolve( __dirname, active?.entry ?? 'index.html' ),
		},
	},
} );
