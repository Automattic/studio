import { copyFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { getSentryReleaseInfo } from '../studio/src/lib/sentry-release';

const __dirname = import.meta.dirname;
const pkg = createRequire( import.meta.url )( './package.json' ) as {
	dependencies?: Record< string, string >;
};

// Dedupe + pre-bundle every direct dep so packages with module-scoped state
// (React's hooks dispatcher, etc.) can't accidentally resolve to two
// instances. Workspace packages (`file:`) are skipped because Vite
// pre-bundling expects a resolvable package entry and our workspace packages
// ship subpaths only.
const directDeps = Object.entries( pkg.dependencies ?? {} )
	.filter( ( [ , version ] ) => ! version.startsWith( 'file:' ) )
	.map( ( [ name ] ) => name );

// The browser target (`STUDIO_TARGET=local`, served by `studio ui`) builds a
// standalone browser app wired to the HTTP/SSE `local` connector instead of the
// Electron IPC bridge. It uses its own entry/output/port so the default
// Electron-renderer build (`dist/`, port 5200) stays byte-for-byte unchanged.
// `STUDIO_TARGET=web` builds Studio on the web: a static site wired to the
// `web` connector, which needs no Studio server at all.
const isWeb = process.env.STUDIO_TARGET === 'web';
const isBrowser = process.env.STUDIO_TARGET === 'local' || isWeb;
const active = isWeb
	? {
			entry: 'index.web.html',
			outDir: 'dist-web',
			port: 3456,
			pages: [ 'site-viewer.html' ],
	  }
	: isBrowser
	? { entry: 'index.local.html', outDir: 'dist-local', port: 5400, pages: [] }
	: undefined;

// The Electron renderer reports errors through the desktop app's Sentry
// client, so release builds upload its source maps under the app's release.
const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo(
	createRequire( import.meta.url )( '../studio/package.json' ).version
);
const uploadSourceMaps = ! isBrowser && ! isDevEnvironment && !! process.env.SENTRY_AUTH_TOKEN;

// The page the dev server serves for document navigations: the browser app, or
// the playground homepage (`STUDIO_TARGET=playground`, see src/dev/README.md).
const devEntry =
	active?.entry ?? ( process.env.STUDIO_TARGET === 'playground' ? 'playground.html' : undefined );

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
			if ( devEntry && accept.includes( 'text/html' ) && ! isInternal ) {
				req.url = `/${ devEntry }`;
			}
			next();
		} );
	},
};

// Static hosts serve `index.html`, and `404.html` for the app's other routes
// (`/sessions/:id`, `/sites/:id`), which the router resolves client-side.
const staticHostPagesPlugin: Plugin = {
	name: 'studio-static-host-pages',
	apply: 'build',
	closeBundle() {
		const outDir = resolve( __dirname, 'dist-web' );
		copyFileSync( resolve( outDir, 'index.web.html' ), resolve( outDir, 'index.html' ) );
		copyFileSync( resolve( outDir, 'index.web.html' ), resolve( outDir, '404.html' ) );
	},
};

// The browser dev server proxies the `studio ui` server, so the app calls it
// same-origin, as it does when that server serves the built app.
const studioUiServer = process.env.STUDIO_UI_SERVER ?? 'http://localhost:8081';

export default defineConfig( {
	plugins: [
		react(),
		...( devEntry ? [ browserDevEntryPlugin ] : [] ),
		...( isWeb ? [ staticHostPagesPlugin ] : [] ),
		// Sentry must be the last plugin
		uploadSourceMaps &&
			sentryVitePlugin( {
				authToken: process.env.SENTRY_AUTH_TOKEN,
				org: 'a8c',
				project: 'studio',
				release: { name: sentryRelease },
			} ),
	],
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
		proxy:
			isBrowser && ! isWeb
				? {
						'/api': { target: studioUiServer, changeOrigin: true },
						'/auth/callback': { target: studioUiServer, changeOrigin: true },
				  }
				: undefined,
	},
	// The static web build previews at the dev server's origin, where the OAuth
	// redirect is registered.
	preview: isWeb ? { port: active?.port } : undefined,
	build: {
		outDir: active?.outDir ?? 'dist',
		sourcemap: ! isBrowser,
		rolldownOptions: {
			input: [ active?.entry ?? 'index.html', ...( active?.pages ?? [] ) ].map( ( page ) =>
				resolve( __dirname, page )
			),
		},
	},
} );
