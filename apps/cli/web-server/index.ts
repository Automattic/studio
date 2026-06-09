import { isAiModelId } from '@studio/common/ai/models';
import {
	appendModelChangeEntry,
	appendStudioEntry,
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '@studio/common/ai/sessions/store';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import express from 'express';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import {
	answerAgentRun,
	interruptAgentRun,
	listActiveAgentRuns,
	setBroadcast,
	startAgentRun,
} from './agent-runs';
import {
	ensureWorkspace,
	getWorkspaceChanges,
	getWorkspaceFiles,
	publishWorkspace,
} from './workspaces';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { SitesEndpointSite } from '@studio/common/types/sync';
import type { Request, Response } from 'express';

const DEFAULT_PORT = 8088;

function getPort(): number {
	return parseInt( process.env.STUDIO_WEB_SERVER_PORT ?? String( DEFAULT_PORT ), 10 );
}

// Express 5 types route params as `string | string[]`; named params are always
// plain strings at runtime, so narrow them here.
function param( req: Request, name: string ): string {
	const value = req.params[ name ];
	return Array.isArray( value ) ? value[ 0 ] ?? '' : value ?? '';
}

const root = getAiSessionsRootDirectory();
const app = express();

// Permissive CORS for the localhost PoC: the SPA dev server (5300) and this
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

app.use( express.json() );

// --- Server-Sent Events: one stream carries every run's AgentRunEvents -------

const sseClients = new Set< Response >();

app.get( '/events', ( req: Request, res: Response ) => {
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

function broadcastSse( payload: unknown ): void {
	const data = JSON.stringify( payload );
	for ( const client of sseClients ) {
		client.write( `data: ${ data }\n\n` );
	}
}

// Broadcast every agent event to all connected SSE clients, in the same
// envelope the web connector expects (channel + payload). When a run finishes,
// also emit a `preview` signal so the client-side Playground knows the agent's
// workspace files changed and can re-sync the live preview.
setBroadcast( ( event: AgentRunEvent ) => {
	broadcastSse( { channel: 'agent', payload: event } );
	if ( event.event.type === 'run.exited' ) {
		broadcastSse( { channel: 'preview', payload: { sessionId: event.sessionId } } );
	}
} );

// --- Health ------------------------------------------------------------------

app.get( '/health', ( _req: Request, res: Response ) => {
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

app.get( '/sites', async ( _req: Request, res: Response ) => {
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
} );

// --- AI sessions -------------------------------------------------------------

app.get( '/sessions', async ( _req: Request, res: Response ) => {
	res.json( await listAiSessions( root ) );
} );

app.post( '/sessions', async ( _req: Request, res: Response ) => {
	// Studio Web runs the agent on a per-session, git-backed workspace — the
	// cloud analog of Studio App's local site. Create the session, provision its
	// workspace, and bind it via a `studio.site_selected` entry so the forked
	// agent (`code sessions resume`) resolves the workspace as its active site.
	// (`siteId` for seeding from an existing WP.com site is a later increment.)
	const session = await createAiSession( root );
	const workspace = ensureWorkspace( session.id );
	await appendStudioEntry( root, session.id, 'studio.site_selected', {
		siteName: workspace.name,
		sitePath: workspace.path,
		remote: false,
	} );
	res.json( await loadAiSession( root, session.id ) );
} );

app.get( '/sessions/:id', async ( req: Request, res: Response ) => {
	res.json( await loadAiSession( root, param( req, 'id' ) ) );
} );

app.delete( '/sessions/:id', async ( req: Request, res: Response ) => {
	await deleteAiSession( root, param( req, 'id' ) );
	res.sendStatus( 204 );
} );

app.patch( '/sessions/:id', async ( req: Request, res: Response ) => {
	// Star/archive aren't persisted in the PoC (no shared store helper); echo
	// the requested state on top of the current summary so the UI stays in sync.
	const { summary } = await loadAiSession( root, param( req, 'id' ) );
	const patch = req.body as { starred?: boolean; archived?: boolean };
	res.json( { ...summary, ...patch } );
} );

app.post( '/sessions/:id/model', async ( req: Request, res: Response ) => {
	const { model } = req.body as { model?: string };
	if ( ! model || ! isAiModelId( model ) ) {
		res.status( 400 ).json( { error: `Unknown AI model: ${ model }` } );
		return;
	}
	await appendModelChangeEntry( root, param( req, 'id' ), '', model );
	res.sendStatus( 204 );
} );

// The session's draft change set: what the agent has edited in the workspace
// but not yet published. `git status` is the change set (Matt B's git-as-project
// container model).
app.get( '/sessions/:id/changes', ( req: Request, res: Response ) => {
	res.json( getWorkspaceChanges( param( req, 'id' ) ) );
} );

// The workspace's deployable files (path + base64 content). The browser overlays
// these onto a client-side WordPress Playground to render a live preview of what
// the agent built — no server-side site serving needed (Carril A).
app.get( '/sessions/:id/site-files', ( req: Request, res: Response ) => {
	res.json( getWorkspaceFiles( param( req, 'id' ) ) );
} );

// Publish the draft: snapshot the workspace as a commit (and push to the deploy
// remote when one is configured — the hosted product's deploy to WordPress.com).
app.post( '/sessions/:id/publish', ( req: Request, res: Response ) => {
	res.json( publishWorkspace( param( req, 'id' ) ) );
} );

app.post( '/sessions/:id/messages', ( req: Request, res: Response ) => {
	const { prompt, displayMessage } = req.body as { prompt?: string; displayMessage?: string };
	if ( ! prompt ) {
		res.status( 400 ).json( { error: 'prompt is required' } );
		return;
	}
	const { runId } = startAgentRun( { sessionId: param( req, 'id' ), prompt, displayMessage } );
	res.json( { runId } );
} );

// --- Runs --------------------------------------------------------------------

app.get( '/runs/active', ( _req: Request, res: Response ) => {
	res.json( listActiveAgentRuns() );
} );

app.post( '/runs/:runId/interrupt', ( req: Request, res: Response ) => {
	interruptAgentRun( param( req, 'runId' ) );
	res.sendStatus( 204 );
} );

app.post( '/runs/:runId/answer', ( req: Request, res: Response ) => {
	const { answers } = req.body as { answers?: Record< string, string > };
	answerAgentRun( param( req, 'runId' ), answers ?? {} );
	res.sendStatus( 204 );
} );

// --- Error handling ----------------------------------------------------------

app.use( ( err: unknown, _req: Request, res: Response, _next: ( e?: unknown ) => void ) => {
	const message = err instanceof Error ? err.message : String( err );
	res.status( 500 ).json( { error: message } );
} );

const port = getPort();
const server = app.listen( port, () => {
	console.log( `\nWordPress Studio Web Server` );
	console.log( `==========================` );
	console.log( `Listening:  http://localhost:${ port }` );
	console.log( `Health:     http://localhost:${ port }/health` );
	console.log( `Events:     http://localhost:${ port }/events (SSE)` );
	console.log( '' );
	console.log( `Point the web UI at this with VITE_STUDIO_API_URL=http://localhost:${ port }` );
	console.log( '' );
} );

process.on( 'SIGINT', () => {
	server.close( () => process.exit( 0 ) );
} );
process.on( 'SIGTERM', () => {
	server.close( () => process.exit( 0 ) );
} );
