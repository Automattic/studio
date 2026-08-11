import { createRequire } from 'module';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import dsTokenFallbacks from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';
import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';

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

// Browser targets build a standalone browser app instead of the Electron IPC
// renderer. Each uses a separate entry/output/port so the default Electron
// renderer build (`dist/`, port 5200) stays byte-for-byte unchanged:
//   STUDIO_TARGET=hosted    → index.hosted.html    → dist-hosted,    port 5300 (cloud)
//   STUDIO_TARGET=local     → index.local.html     → dist-local,     port 5400 (`studio ui`)
//   STUDIO_TARGET=marketing → index.marketing.html → dist-marketing, port 5500 (screenshots)
type BrowserTarget = 'hosted' | 'local' | 'marketing';
const target = process.env.STUDIO_TARGET as BrowserTarget | undefined;
const isBrowser = target === 'hosted' || target === 'local' || target === 'marketing';
const browserConfig: Record< BrowserTarget, { entry: string; outDir: string; port: number } > = {
	hosted: { entry: 'index.hosted.html', outDir: 'dist-hosted', port: 5300 },
	local: { entry: 'index.local.html', outDir: 'dist-local', port: 5400 },
	marketing: { entry: 'index.marketing.html', outDir: 'dist-marketing', port: 5500 },
};
const active = isBrowser ? browserConfig[ target as BrowserTarget ] : undefined;

// In dev and preview, Vite otherwise serves the root Electron `index.html` (or
// no root document at all for a multi-page build). Rewrite document navigation
// to the active browser target so client-side routes and refreshes work. The
// marketing-only iframe root resolves to its deterministic preview fixture.
function rewriteBrowserDocumentRequest( req: IncomingMessage ): void {
	const accept = req.headers.accept ?? '';
	const [ pathname ] = ( req.url ?? '' ).split( '?' );
	if (
		target === 'marketing' &&
		pathname === '/' &&
		req.headers[ 'sec-fetch-dest' ] === 'iframe'
	) {
		req.url = '/marketing-preview/meridian/index.html';
		return;
	}
	const isInternal =
		pathname.startsWith( '/@' ) ||
		pathname.startsWith( '/src/' ) ||
		pathname.startsWith( '/node_modules/' ) ||
		pathname.includes( '.' );
	if ( active && accept.includes( 'text/html' ) && ! isInternal ) {
		req.url = `/${ active.entry }`;
	}
}

const browserDevEntryPlugin: Plugin = {
	name: 'studio-browser-dev-entry',
	apply: 'serve',
	configureServer( server ) {
		server.middlewares.use( ( req, _res, next ) => {
			rewriteBrowserDocumentRequest( req );
			next();
		} );
	},
	configurePreviewServer( server ) {
		server.middlewares.use( ( req, _res, next ) => {
			rewriteBrowserDocumentRequest( req );
			next();
		} );
	},
};

export default defineConfig( {
	plugins: [ react(), dsTokenFallbacks(), ...( isBrowser ? [ browserDevEntryPlugin ] : [] ) ],
	...( target === 'marketing' ? { publicDir: resolve( __dirname, 'public-marketing' ) } : {} ),
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
