import { createRequire } from 'module';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ServerOptions } from 'vite';
import { getSentryReleaseInfo } from '../../packages/common/lib/sentry-release';

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
				pathname.includes( '.' ) ||
				// Pages a server behind the dev proxy answers, such as the sign-in callback.
				Object.keys( target?.proxy ?? {} ).some( ( prefix ) => pathname.startsWith( prefix ) );
			if ( devEntry && accept.includes( 'text/html' ) && ! isInternal ) {
				req.url = `/${ devEntry }`;
			}
			next();
		} );
	},
};

// The browser dev server proxies the `studio ui` server, so the app calls it
// same-origin, as it does when that server serves the built app.
const studioUiServer = process.env.STUDIO_UI_SERVER ?? 'http://localhost:8081';

// Studio Cloud's control plane, a separate service, which serves `/cloud/*` next to the page.
const studioCloudControl = process.env.STUDIO_CLOUD_CONTROL ?? 'http://localhost:3460';

// The browser targets build the app on their own entry, output and port, so the
// default Electron-renderer build (`dist/`, port 5200) stays byte-for-byte
// unchanged. Both are wired to the HTTP/SSE `local` connector: `local` is served
// by `studio ui`, `cloud` by Studio Cloud next to its control plane.
const TARGETS: Partial<
	Record<
		string,
		{
			entry: string;
			outDir: string;
			port: number;
			proxy?: ServerOptions[ 'proxy' ];
		}
	>
> = {
	local: {
		entry: 'index.local.html',
		outDir: 'dist-local',
		port: 5400,
		proxy: {
			'/api': { target: studioUiServer, changeOrigin: true },
			'/auth/callback': { target: studioUiServer, changeOrigin: true },
		},
	},
	// Studio Cloud: the page and its control plane on one origin, the user's machine on another.
	cloud: {
		entry: 'index.cloud.html',
		outDir: 'dist-cloud',
		port: 3456,
		proxy: {
			'/cloud': { target: studioCloudControl, changeOrigin: true },
			'/auth/callback': { target: studioCloudControl, changeOrigin: true },
		},
	},
};
const target = TARGETS[ process.env.STUDIO_TARGET ?? '' ];

// Release builds upload source maps under the app's release. The Electron renderer reports through
// the desktop app's Sentry client; the browser builds (`studio ui`, Studio Cloud) report on their own,
// and don't serve their maps.
const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo(
	createRequire( import.meta.url )( '../studio/package.json' ).version
);
const uploadSourceMaps = ! isDevEnvironment && !! process.env.SENTRY_AUTH_TOKEN;

// The page the dev server serves for document navigations: the browser app, or
// the playground homepage (`STUDIO_TARGET=playground`, see src/dev/README.md).
const devEntry =
	target?.entry ?? ( process.env.STUDIO_TARGET === 'playground' ? 'playground.html' : undefined );

export default defineConfig( {
	plugins: [
		react(),
		...( devEntry ? [ browserDevEntryPlugin ] : [] ),
		// Sentry must be the last plugin
		uploadSourceMaps &&
			sentryVitePlugin( {
				authToken: process.env.SENTRY_AUTH_TOKEN,
				org: 'a8c',
				project: 'studio',
				release: { name: sentryRelease },
				sourcemaps: target
					? { filesToDeleteAfterUpload: [ resolve( __dirname, target.outDir, '**/*.map' ) ] }
					: undefined,
			} ),
	],
	define: {
		// The release the browser builds report under, when built in CI: a local build reports nothing.
		// The Electron renderer reports through the app.
		__SENTRY_RELEASE__: JSON.stringify(
			target && ! isDevEnvironment && process.env.CI ? sentryRelease : null
		),
	},
	resolve: {
		alias: {
			'@': resolve( __dirname, 'src' ),
			// `@wp-playground/blueprints` ships the schema validator as a sibling
			// module that isn't listed in the package's `exports` map. Shared
			// helpers in @studio/blueprints (validate.ts) import it via
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
		port: target?.port ?? 5200,
		proxy: target?.proxy,
	},
	build: {
		outDir: target?.outDir ?? 'dist',
		sourcemap: ! target || ( uploadSourceMaps && 'hidden' ),
		rolldownOptions: {
			input: resolve( __dirname, target?.entry ?? 'index.html' ),
		},
	},
} );
