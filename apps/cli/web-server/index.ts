import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAiModelId } from '@studio/common/ai/models';
import {
	appendModelChangeEntry,
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '@studio/common/ai/sessions/store';
import {
	readAuthToken,
	readSharedSessions,
	updateSharedSession,
} from '@studio/common/lib/shared-config';
import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import {
	answerAgentRun,
	interruptAgentRun,
	listActiveAgentRuns,
	setAgentRuntime,
	setBroadcast,
	startAgentRun,
} from './agent-runs';
import { createSecexRuntime } from './secex-runtime';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';
import type { SitesEndpointSite } from '@studio/common/types/sync';
import type { Request, Response } from 'express';

/**
 * Studio Web's **local development backend**.
 *
 * It is NOT the eventual Studio Web server. It is a stand-in that runs the
 * agent on this machine (forking the same `studio code` subcommand the desktop
 * app forks) so the browser UI has something to talk to while the real hosted
 * backend — where the agent runs in a per-session SecEx sandbox and sites are
 * persisted (git is the leading proposal) — is designed and built.
 *
 * The durable, portable contract is the pair {@link Connector} interface +
 * this HTTP/SSE API shape, not Express. Swapping this for the hosted backend
 * means re-implementing the same routes against that infrastructure; the
 * browser UI and the web connector don't change. Express is just the most
 * boring way to stand the contract up locally.
 *
 * See `apps/cli/web-server/README.md` for the local↔hosted topology.
 */

const DEFAULT_PORT = 8088;

function getPort(): number {
	return parseInt( process.env.STUDIO_WEB_SERVER_PORT ?? String( DEFAULT_PORT ), 10 );
}

// Star/archive live in the shared config (`~/.studio/shared.json`), not the
// session JSONL — the same store the desktop app reads, so flags set in either
// surface show up in both.
function hydrateAiSessionSummary(
	summary: AiSessionSummary,
	metadata?: Pick< AiSessionSummary, 'starred' | 'archived' >
): AiSessionSummary {
	return { ...summary, starred: metadata?.starred, archived: metadata?.archived };
}

const root = getAiSessionsRootDirectory();

// Where the agent runs. Default: a local child process (this dev backend). Set
// `STUDIO_WEB_BACKEND=secex` to run it in a hosted SecEx sandbox via the wpcom
// `studio-code` endpoint instead — the run-manager and the browser don't change.
if ( process.env.STUDIO_WEB_BACKEND === 'secex' ) {
	setAgentRuntime( createSecexRuntime( { runUrl: process.env.STUDIO_SECEX_RUN_URL } ) );
}

const app = express();
// All API routes live under `/api` so they can't collide with the SPA's
// real-path routes (`/sessions/:id` is both an app URL and an API resource).
const api = express.Router();

// Express 4 doesn't forward async rejections to the error middleware — an
// unhandled rejection would take the whole process down — so async routes go
// through this wrapper.
function asyncHandler( fn: ( req: Request, res: Response ) => Promise< void > ) {
	return ( req: Request, res: Response, next: ( e?: unknown ) => void ) => {
		fn( req, res ).catch( next );
	};
}

// Permissive CORS for local development: the SPA dev server (5300) and this
// backend live on different ports. EventSource (GET /events) needs no
// preflight, but the JSON POST/PATCH/DELETE routes do.
app.use( ( req: Request, res: Response, next ) => {
	res.setHeader( 'Access-Control-Allow-Origin', req.headers.origin ?? '*' );
	res.setHeader( 'Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS' );
	res.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );
	if ( req.method === 'OPTIONS' ) {
		res.sendStatus( 204 );
		return;
	}
	next();
} );

// Generous ceiling a single local user never hits in practice — the server is
// loopback-only, but a runaway client (or anything that does slip through)
// shouldn't be able to hammer the session store or the WordPress.com API.
app.use(
	rateLimit( {
		windowMs: 60_000,
		limit: 1_000,
		standardHeaders: true,
		legacyHeaders: false,
	} )
);

app.use( express.json() );

// --- Server-Sent Events: one stream carries every run's AgentRunEvents -------

const sseClients = new Set< Response >();

api.get( '/events', ( req: Request, res: Response ) => {
	res.setHeader( 'Content-Type', 'text/event-stream' );
	res.setHeader( 'Cache-Control', 'no-cache' );
	res.setHeader( 'Connection', 'keep-alive' );
	res.flushHeaders?.();
	res.write( ': connected\n\n' );
	sseClients.add( res );
	req.on( 'close', () => {
		sseClients.delete( res );
	} );
} );

// Broadcast every agent event to all connected SSE clients, in the same
// envelope the web connector expects (channel + payload).
setBroadcast( ( event: AgentRunEvent ) => {
	if ( sseClients.size === 0 ) {
		return;
	}
	const data = JSON.stringify( { channel: 'agent', payload: event } );
	for ( const client of sseClients ) {
		client.write( `data: ${ data }\n\n` );
	}
} );

// --- Health ------------------------------------------------------------------

api.get( '/health', ( _req: Request, res: Response ) => {
	res.json( { status: 'ok' } );
} );

// --- Sites -------------------------------------------------------------------

// Studio Web is a hosted product: the browser has no local Studio. The site
// list is the user's WordPress.com sites, fetched live from the dotcom API
// using the stored auth token — not local Studio config. We list only sites the
// user can actually work on in Studio (Studio's own "syncable" criterion:
// administered, supported host/plan, not deleted), so the 1000s of P2s a user
// can merely read don't flood the list.
const WPCOM_SITE_FIELDS = [
	'ID',
	'name',
	'URL',
	'icon',
	'is_deleted',
	'capabilities',
	'is_wpcom_atomic',
	'plan',
	'jetpack',
	'hosting_provider_guess',
	'environment_type',
	'options',
].join( ',' );

api.get(
	'/sites',
	asyncHandler( async ( _req: Request, res: Response ) => {
		const token = await readAuthToken();
		if ( ! token ) {
			// Not signed in to WordPress.com — no sites to show.
			res.json( [] );
			return;
		}

		const url = new URL( 'https://public-api.wordpress.com/rest/v1.1/me/sites' );
		url.searchParams.set( 'fields', WPCOM_SITE_FIELDS );
		// `wpcom_staging_blog_ids` lets us point the browser at a site's staging
		// environment instead of production (see below).
		url.searchParams.set( 'options', 'wpcom_staging_blog_ids' );
		const response = await fetch( url, {
			headers: { Authorization: `Bearer ${ token.accessToken }` },
		} );
		if ( ! response.ok ) {
			res.status( response.status ).json( {
				error: `WordPress.com sites fetch failed (${ response.status })`,
			} );
			return;
		}

		const body = ( await response.json() ) as { sites?: SitesEndpointSite[] };
		const allSites = body.sites ?? [];

		// Look up any site's URL by blog id, and collect every staging blog id so
		// staging environments aren't listed as their own cards (they're surfaced
		// through their production parent below).
		const urlByBlogId = new Map< number, string >();
		const stagingBlogIds = new Set< number >();
		for ( const site of allSites ) {
			urlByBlogId.set( site.ID, site.URL );
			for ( const stagingId of site.options?.wpcom_staging_blog_ids ?? [] ) {
				stagingBlogIds.add( stagingId );
			}
		}

		const sites = allSites
			// `getSyncSupport` with no connected ids returns 'syncable' for sites the
			// user administers on a supported host/plan — i.e. usable in Studio.
			.filter( ( site ) => getSyncSupport( site, [] ) === 'syncable' )
			.filter( ( site ) => ! stagingBlogIds.has( site.ID ) )
			.map( ( site ) => {
				// Studio Web edits sites on their staging environment, never
				// production. When a site has a staging blog, surface its URL.
				const stagingId = site.options?.wpcom_staging_blog_ids?.[ 0 ];
				const siteUrl = ( stagingId && urlByBlogId.get( stagingId ) ) || site.URL;
				return {
					id: String( site.ID ),
					name: site.name || site.URL || String( site.ID ),
					path: '',
					port: 0,
					running: true,
					url: siteUrl,
					phpVersion: '',
					siteIcon: site.icon?.img ?? null,
				};
			} );
		res.json( sites );
	} )
);

// --- AI sessions -------------------------------------------------------------

api.get(
	'/sessions',
	asyncHandler( async ( _req: Request, res: Response ) => {
		const [ sessions, sessionMetadata ] = await Promise.all( [
			listAiSessions( root ),
			readSharedSessions(),
		] );
		res.json(
			sessions.map( ( session ) =>
				hydrateAiSessionSummary( session, sessionMetadata[ session.id ] )
			)
		);
	} )
);

api.post(
	'/sessions',
	asyncHandler( async ( _req: Request, res: Response ) => {
		// `siteId` is accepted but not yet wired: sessions start unbound and the
		// agent creates/binds a site during the run.
		res.json( await createAiSession( root ) );
	} )
);

api.get(
	'/sessions/:id',
	asyncHandler( async ( req: Request, res: Response ) => {
		const [ loaded, sessionMetadata ] = await Promise.all( [
			loadAiSession( root, req.params.id ),
			readSharedSessions(),
		] );
		res.json( {
			...loaded,
			summary: hydrateAiSessionSummary( loaded.summary, sessionMetadata[ loaded.summary.id ] ),
		} );
	} )
);

api.delete(
	'/sessions/:id',
	asyncHandler( async ( req: Request, res: Response ) => {
		await deleteAiSession( root, req.params.id );
		res.sendStatus( 204 );
	} )
);

api.patch(
	'/sessions/:id',
	asyncHandler( async ( req: Request, res: Response ) => {
		const { summary } = await loadAiSession( root, req.params.id );
		const patch = req.body as { starred?: boolean; archived?: boolean };
		// Same persistence the desktop app uses (updateAiSessionMetadata in
		// ipc-handlers.ts): flags go to the shared config under its lock.
		const metadata = await updateSharedSession( summary.id, patch );
		res.json( hydrateAiSessionSummary( summary, metadata ) );
	} )
);

api.post(
	'/sessions/:id/model',
	asyncHandler( async ( req: Request, res: Response ) => {
		const { model } = req.body as { model?: string };
		if ( ! model || ! isAiModelId( model ) ) {
			res.status( 400 ).json( { error: `Unknown AI model: ${ model }` } );
			return;
		}
		await appendModelChangeEntry( root, req.params.id, '', model );
		res.sendStatus( 204 );
	} )
);

api.post( '/sessions/:id/messages', ( req: Request, res: Response ) => {
	const { prompt, displayMessage } = req.body as { prompt?: string; displayMessage?: string };
	if ( ! prompt ) {
		res.status( 400 ).json( { error: 'prompt is required' } );
		return;
	}
	const { runId } = startAgentRun( { sessionId: req.params.id, prompt, displayMessage } );
	res.json( { runId } );
} );

// --- Runs --------------------------------------------------------------------

api.get( '/runs/active', ( _req: Request, res: Response ) => {
	res.json( listActiveAgentRuns() );
} );

api.post( '/runs/:runId/interrupt', ( req: Request, res: Response ) => {
	interruptAgentRun( req.params.runId );
	res.sendStatus( 204 );
} );

api.post( '/runs/:runId/answer', ( req: Request, res: Response ) => {
	const { answers } = req.body as { answers?: Record< string, string > };
	answerAgentRun( req.params.runId, answers ?? {} );
	res.sendStatus( 204 );
} );

app.use( '/api', api );

// --- Web UI ------------------------------------------------------------------

// Serve the built browser UI (apps/ui `npm run build:web`) so `studio
// web-server` is the only command needed: API and SPA share one origin. When
// the build output isn't there (API-only usage, or UI served by the Vite dev
// server on :5300), the server still works and the startup message says how to
// get the UI.
const uiDist =
	process.env.STUDIO_WEB_UI_DIST ??
	path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../../ui/dist-web' );
const uiIndex = path.join( uiDist, 'index.web.html' );
const hasUi = existsSync( uiIndex );
if ( hasUi ) {
	app.use( express.static( uiDist ) );
	// SPA fallback: the app uses real-path routing (/sessions/:id, /sites/:id),
	// so any unmatched HTML navigation reloads into the app shell. API routes
	// are registered above and keep precedence.
	app.get( '*', ( req: Request, res: Response, next ) => {
		if ( ( req.headers.accept ?? '' ).includes( 'text/html' ) ) {
			res.sendFile( uiIndex );
			return;
		}
		next();
	} );
}

// --- Error handling ----------------------------------------------------------

app.use( ( err: unknown, _req: Request, res: Response, _next: ( e?: unknown ) => void ) => {
	const message = err instanceof Error ? err.message : String( err );
	res.status( 500 ).json( { error: message } );
} );

const port = getPort();
// Bind to loopback only: the server exposes the local user's sessions and
// WordPress.com data without authentication, so it must not be reachable from
// the network.
const server = app.listen( port, '127.0.0.1', () => {
	console.log( `\nWordPress Studio Web Server` );
	console.log( `==========================` );
	if ( hasUi ) {
		console.log( `Open:       http://localhost:${ port }` );
	}
	console.log( `Health:     http://localhost:${ port }/api/health` );
	console.log( `Events:     http://localhost:${ port }/api/events (SSE)` );
	console.log( '' );
	if ( ! hasUi ) {
		console.log( `No web UI build found at ${ uiDist }.` );
		console.log(
			`Build it with \`npm run build:web --workspace=apps/ui\`, or run the dev server with \`npm run dev:web --workspace=apps/ui\` and open http://localhost:5300.`
		);
		console.log( '' );
	}
} );

process.on( 'SIGINT', () => {
	server.close( () => process.exit( 0 ) );
} );
process.on( 'SIGTERM', () => {
	server.close( () => process.exit( 0 ) );
} );
