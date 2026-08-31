import crypto from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, rm } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/common/ai/global-instructions';
import { isAiModelId } from '@studio/common/ai/models';
import { isAiProviderId, providerServesModel } from '@studio/common/ai/providers';
import { createAgentRunManager } from '@studio/common/ai/run-manager';
import {
	createOrReuseAiSession,
	hydrateAiSessionSummary,
	listHydratedAiSessions,
	loadHydratedAiSession,
} from '@studio/common/ai/sessions/manage';
import {
	deleteAiSessionPlacement,
	readAiSessionPlacement,
} from '@studio/common/ai/sessions/placement';
import {
	appendModelChangeEntry,
	appendStudioEntry,
	deleteAiSession,
	loadAiSession,
} from '@studio/common/ai/sessions/store';
import {
	InvalidAnthropicApiKeyError,
	readAiSettings,
	saveAnthropicApiKey,
	setAiProvider,
} from '@studio/common/ai/settings-store';
import { expandSkillCommandPrompt } from '@studio/common/ai/slash-commands';
import { getAiTracksIdentity } from '@studio/common/ai/tracks-identity';
import { DEFAULT_TOKEN_LIFETIME_MS } from '@studio/common/constants';
import { createCliRunner } from '@studio/common/lib/cli-process';
import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser,
	getConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
} from '@studio/common/lib/connected-sites';
import {
	arePathsEqual,
	confineToRoot,
	isEmptyDir,
	isWordPressDirectory,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { generateNumberedName, generateSiteName } from '@studio/common/lib/generate-site-name';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { importIpcEventSchema } from '@studio/common/lib/import-export-events';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getAuthenticationUrl, getSignUpUrl } from '@studio/common/lib/oauth';
import { decodePassword } from '@studio/common/lib/passwords';
import {
	getInstructionsLengthBucket,
	isTracksEventName,
	TRACKS_EVENTS,
} from '@studio/common/lib/record-tracks-event';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import {
	deleteSharedSession,
	readAuthToken,
	updateSharedConfig,
	updateSharedSession,
} from '@studio/common/lib/shared-config';
import { fetchStudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import { fetchStudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { fetchLatestRewindId, fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { detectInstalledApps } from '@studio/common/lib/user-settings/installed-apps';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import {
	cleanupBlueprintTempDir,
	extractBlueprintUpload,
} from '@studio/common/sites/blueprint-extract';
import { buildSiteCreateArgs, type SiteCreateOptions } from '@studio/common/sites/create';
import { buildSiteSetArgs } from '@studio/common/sites/edit';
import { startSite, stopSite } from '@studio/common/sites/lifecycle';
import { listSites } from '@studio/common/sites/list';
import { readSitePath } from '@studio/common/sites/site-path';
import { createSnapshotManager, fetchSnapshots } from '@studio/common/sites/snapshots';
import { measureSiteStorage } from '@studio/common/sites/storage-usage';
import { pullSite, pushSite } from '@studio/common/sites/sync';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { isEditor, isTerminal, openInEditor, openInTerminal, openPath } from './open-in-os';
import {
	readSiteSortOrders,
	readUserPreferences,
	userPreferencesPatchSchema,
	writeSiteSortOrders,
	writeUserPreferences,
} from './user-preferences';
import type { UserPreferencesContext } from './user-preferences';
import type { AiSettings } from '@studio/common/ai/providers';
import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { EditSiteOptions } from '@studio/common/sites/edit';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
import type { Request, Response } from 'express';

/**
 * The local Studio web server: the browser analog of the desktop app, exposed
 * over HTTP/SSE instead of IPC. It is bundled into the Studio CLI and started by
 * the `studio ui` command, which injects how to reach the CLI binary and where
 * sessions live.
 *
 * The business logic is NOT reimplemented here — every route delegates to the
 * same `@studio/common` code the desktop app uses (the session store, the site
 * operations, and the agent run-manager). The CLI binary is forked exactly the
 * way the desktop forks it; only the transport differs.
 */

export interface LocalServerOptions {
	// Absolute path to the CLI entry to fork for site/agent operations.
	cliBinary: string;
	// Node binary to fork the CLI with. Defaults to `process.execPath` (correct
	// when the server runs inside the CLI, which is itself a Node process).
	nodeBinary?: string;
	// Root directory where AI sessions are stored (the CLI's appdata sessions
	// dir), so the browser sees the same sessions the CLI and desktop write.
	sessionsRoot: string;
	// Default root for new site folders (the CLI's `~/Studio`), used to propose
	// paths/names in the create form.
	sitesRoot: string;
	// Port to listen on. Defaults to STUDIO_LOCAL_SERVER_PORT or 8081.
	port?: number;
	// Host to bind. Defaults to loopback (127.0.0.1) — the server is
	// unauthenticated and must not be reachable from the network.
	host?: string;
	// Path to the built browser UI (apps/ui `dist-local`). Served when present
	// so the server is the only process needed; omitted in dev (Vite serves it).
	uiDist?: string;
	// Injected by `studio ui` rather than imported, so this package doesn't depend
	// on the CLI.
	recordTracksEvent?: ( event: TracksEventName, props?: TracksProps ) => Promise< void >;
}

export interface LocalServer {
	url: string;
	port: number;
	close(): Promise< void >;
}

const DEFAULT_PORT = 8081;

// Served at <origin>/auth/callback — the OAuth redirect target for the browser
// login flow. WordPress.com lands here with the token in the URL fragment
// (implicit grant), which never reaches the server, so this page reads it
// client-side, hands it to /api/auth/login to validate + store, then notifies
// the opener window and closes.
const AUTH_CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in…</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;padding:2rem;color:#1e1e1e}</style>
</head><body><p id="msg">Signing you in…</p><script>
(function(){
	var msg=document.getElementById('msg');
	var params=new URLSearchParams(location.hash.slice(1));
	var token=params.get('access_token');
	var error=params.get('error');
	function notify(type,message){try{if(window.opener){window.opener.postMessage({type:type,message:message},location.origin);}}catch(e){}}
	if(error||!token){msg.textContent='Login failed: '+(error||'no token returned');notify('studio-auth-error',error||'no token');return;}
	fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})})
		.then(function(r){if(!r.ok){throw new Error('Token could not be validated');}return r.json();})
		.then(function(){msg.textContent='Signed in! You can close this window.';notify('studio-auth-success');setTimeout(function(){window.close();},800);})
		.catch(function(e){msg.textContent='Login failed: '+e.message;notify('studio-auth-error',e.message);});
})();
</script></body></html>`;

// The agentic UI's SiteDetails shape. The CLI's `site list` already reports
// nearly all of it; thumbnails/theme details/`sortOrder` are desktop-only
// enrichments, merged in by callers.
function toSiteDetails( site: SiteListItem, sortOrder?: number ) {
	return {
		id: site.id,
		name: site.name,
		path: site.path,
		port: site.port,
		running: site.running,
		url: site.url,
		phpVersion: site.phpVersion,
		customDomain: site.customDomain,
		enableHttps: site.enableHttps,
		adminUsername: site.adminUsername,
		adminPassword: site.adminPassword,
		adminEmail: site.adminEmail,
		isWpAutoUpdating: site.isWpAutoUpdating,
		enableXdebug: site.enableXdebug,
		enableDebugLog: site.enableDebugLog,
		enableDebugDisplay: site.enableDebugDisplay,
		operation: site.operation,
		sortOrder,
		siteIcon: null,
	};
}

// `studio-backup-<site>-<timestamp>`, matching the desktop's backup naming.
function backupFilename( siteName: string ): string {
	const now = new Date();
	const pad = ( n: number ) => String( n ).padStart( 2, '0' );
	const ts =
		`${ now.getFullYear() }-${ pad( now.getMonth() + 1 ) }-${ pad( now.getDate() ) }` +
		`_${ pad( now.getHours() ) }_${ pad( now.getMinutes() ) }_${ pad( now.getSeconds() ) }`;
	return sanitizeFolderName( `studio-backup-${ siteName }-${ ts }` );
}

// Express 4 doesn't forward async rejections to the error middleware — an
// unhandled rejection would take the whole process down — so async routes go
// through this wrapper.
function asyncHandler( fn: ( req: Request, res: Response ) => Promise< void > ) {
	return ( req: Request, res: Response, next: ( e?: unknown ) => void ) => {
		fn( req, res ).catch( next );
	};
}

// The server owns these; a client that could set them would disguise its origin.
const CLIENT_RESERVED_TRACKS_PROPS = new Set( [ 'channel', 'ui_version' ] );

// Browser props arrive as untyped JSON, without the structured-clone guarantees
// IPC gives the desktop. Keep only what Tracks can send.
function sanitizeTracksProps( value: unknown ): TracksProps {
	if ( typeof value !== 'object' || value === null ) {
		return {};
	}
	const props: TracksProps = {};
	for ( const [ key, propValue ] of Object.entries( value ) ) {
		if ( CLIENT_RESERVED_TRACKS_PROPS.has( key ) ) {
			continue;
		}
		if (
			typeof propValue === 'string' ||
			typeof propValue === 'number' ||
			typeof propValue === 'boolean'
		) {
			props[ key ] = propValue;
		}
	}
	return props;
}

export async function startLocalServer( options: LocalServerOptions ): Promise< LocalServer > {
	const { cliBinary, nodeBinary, sessionsRoot, sitesRoot, uiDist } = options;
	const port = options.port ?? Number( process.env.STUDIO_LOCAL_SERVER_PORT ?? DEFAULT_PORT );
	const host = options.host ?? '127.0.0.1';

	// Analytics must never fail a user action, so every call is fire-and-forget.
	function trackEvent( event: TracksEventName, props?: TracksProps ): void {
		void options.recordTracksEvent?.( event, props ).catch( () => undefined );
	}

	function preferencesContext(): UserPreferencesContext {
		return { sitesRoot, installedApps: detectInstalledApps() };
	}

	const cliRunner = createCliRunner( { cliBinary, nodeBinary } );
	const execute = cliRunner.executeCliCommand;
	const uploads = new Map< string, { path: string; directory: string } >();

	// --- Server-Sent Events: one stream carries live UI updates ----------------
	const sseClients = new Set< Response >();
	function sseSend( message: { channel: string; payload: unknown } ): void {
		if ( sseClients.size === 0 ) {
			return;
		}
		const data = JSON.stringify( message );
		for ( const client of sseClients ) {
			client.write( `data: ${ data }\n\n` );
		}
	}

	// In-flight push/pull, keyed the same way the desktop keys them
	// (`${siteId}-${remoteSiteId}`), so `/sync/cancel` can abort one.
	const SYNC_ABORT_CONTROLLERS = new Map< string, AbortController >();
	function registerSyncAbort( siteId: string, remoteSiteId: number ) {
		const key = `${ siteId }-${ remoteSiteId }`;
		const controller = new AbortController();
		SYNC_ABORT_CONTROLLERS.set( key, controller );
		const release = () => {
			if ( SYNC_ABORT_CONTROLLERS.get( key ) === controller ) {
				SYNC_ABORT_CONTROLLERS.delete( key );
			}
		};
		release.signal = controller.signal;
		return release;
	}

	// Background watch for the WordPress.com site the user is about to create via
	// the "Create new" checkout. A browser tab can't receive the wp-studio://
	// deep link the desktop uses, so we poll the account's syncable sites and,
	// when a new one appears, report it on the `sync-connect` channel for the
	// connector's onSyncConnectSite to auto-connect. Keyed by studio site id so a
	// re-trigger supersedes the prior watch; all are cancelled on close().
	const publishWatches = new Map< string, { cancelled: boolean } >();
	function startPublishWatch(
		studioSiteId: string,
		expectedName: string,
		accessToken: string,
		knownIds: Set< number >
	): void {
		const previous = publishWatches.get( studioSiteId );
		if ( previous ) {
			previous.cancelled = true;
		}
		const watch = { cancelled: false };
		publishWatches.set( studioSiteId, watch );

		const POLL_INTERVAL_MS = 5_000;
		const slug = expectedName.toLowerCase();
		let attemptsLeft = 60; // ~5 minutes at a 5s interval.

		const poll = async (): Promise< void > => {
			// A superseded/torn-down watch bails before any map mutation so it can't
			// clobber the entry a newer watch now owns.
			if ( watch.cancelled ) {
				return;
			}
			let matchId: number | undefined;
			try {
				const sites = await fetchSyncableSites( accessToken );
				const fresh = sites.filter( ( candidate ) => ! knownIds.has( candidate.id ) );
				const match =
					fresh.find(
						( candidate ) =>
							!! slug &&
							( ( candidate.name ?? '' ).toLowerCase().includes( slug ) ||
								( candidate.url ?? '' ).toLowerCase().includes( slug ) )
					) ?? ( fresh.length === 1 ? fresh[ 0 ] : undefined );
				matchId = match?.id;
			} catch {
				// Transient (token refresh, network); keep polling until the deadline.
			}
			if ( watch.cancelled ) {
				return;
			}
			if ( matchId !== undefined ) {
				publishWatches.delete( studioSiteId );
				sseSend( {
					channel: 'sync-connect',
					payload: { remoteSiteId: matchId, studioSiteId },
				} );
				return;
			}
			if ( --attemptsLeft <= 0 ) {
				publishWatches.delete( studioSiteId );
				return;
			}
			setTimeout( () => void poll(), POLL_INTERVAL_MS );
		};
		void poll();
	}

	const runManager = createAgentRunManager( {
		cliBinary,
		nodeBinary,
		surface: 'cliui',
		// Agent-run events on `agent`, session-placement updates on `placement`.
		emit: ( output ) => sseSend( { channel: output.kind, payload: output.event } ),
	} );

	// Preview snapshots stream their progress on the `snapshot` channel, the
	// same shared manager + emit the desktop wires to IPC.
	const snapshotManager = createSnapshotManager( {
		executeCliCommand: execute,
		emit: ( output ) => sseSend( { channel: 'snapshot', payload: output } ),
	} );

	const app = express();
	// All API routes live under `/api` so they can't collide with the SPA's
	// real-path routes (`/sessions/:id` is both an app URL and an API resource).
	const api = express.Router();

	// Restrict cross-origin access to the known `studio ui` origins. The server is
	// loopback-only, but loopback is reachable from any page in the user's
	// browser, so reflecting arbitrary origins would let any website call this
	// unauthenticated API (read data, or trigger state changes). Requests with no
	// Origin (same-origin navigations, the served SPA's same-origin fetches, curl,
	// SSE) pass through; a present-but-disallowed Origin is rejected outright.
	const allowedOrigins = new Set( [
		`http://localhost:${ port }`,
		`http://127.0.0.1:${ port }`,
		// Vite dev server for `npm run dev:local --workspace=apps/ui`.
		'http://localhost:5400',
		'http://127.0.0.1:5400',
		// The studio.local custom-domain setup.
		'https://studio.local',
	] );
	app.use( ( req: Request, res: Response, next ) => {
		const origin = req.headers.origin;
		if ( origin ) {
			if ( ! allowedOrigins.has( origin ) ) {
				res.status( 403 ).json( { error: 'Origin not allowed' } );
				return;
			}
			res.setHeader( 'Access-Control-Allow-Origin', origin );
			res.setHeader( 'Vary', 'Origin' );
		}
		res.setHeader( 'Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS' );
		res.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );
		if ( req.method === 'OPTIONS' ) {
			res.sendStatus( 204 );
			return;
		}
		next();
	} );

	// Generous ceiling a single local user never hits in practice — the server
	// is loopback-only, but a runaway client shouldn't be able to hammer it.
	app.use(
		rateLimit( { windowMs: 60_000, limit: 1_000, standardHeaders: true, legacyHeaders: false } )
	);

	app.use( express.json() );

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

	api.get( '/health', ( _req: Request, res: Response ) => {
		res.json( { status: 'ok' } );
	} );

	// --- Analytics — the browser UI's equivalent of the desktop's IPC handler --
	// Unknown names are dropped, not forwarded, as in `recordAnalyticsEvent`.
	api.post( '/analytics/event', ( req: Request, res: Response ) => {
		const eventName = req.body?.eventName;
		if ( typeof eventName !== 'string' ) {
			res.status( 400 ).json( { error: 'eventName required' } );
			return;
		}
		if ( ! isTracksEventName( eventName ) ) {
			console.warn( `Ignoring unknown analytics event name: ${ eventName }` );
			res.status( 204 ).end();
			return;
		}
		trackEvent( eventName, sanitizeTracksProps( req.body?.props ) );
		res.status( 204 ).end();
	} );

	// --- Auth — the WordPress.com user the CLI is already logged in as ---------
	// Read straight from the shared auth token (`~/.studio/shared.json`); the
	// stored token carries the user's id/email/displayName, so no API call.
	api.get(
		'/auth/user',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const token = await readAuthToken();
			res.json(
				token ? { id: token.id, email: token.email, displayName: token.displayName } : null
			);
		} )
	);

	// Build the WordPress.com authorize URL for the browser (redirect) login flow,
	// targeting the caller-provided redirect (its own origin + /auth/callback).
	// Returns { url: null } when the caller didn't supply a redirect URI, so the
	// connector falls back to the paste flow.
	api.get( '/auth/login-url', ( req: Request, res: Response ) => {
		const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
		if ( ! redirectUri ) {
			res.json( { url: null } );
			return;
		}
		res.json( {
			url:
				req.query.signup === '1'
					? getSignUpUrl( 'en', redirectUri )
					: getAuthenticationUrl( 'en', redirectUri ),
		} );
	} );

	// Log in by storing a token from the redirect callback (or pasted from
	// WordPress.com's copy-token page — the same implicit-OAuth flow
	// `studio auth login` uses). The token is validated against /me before being
	// written to the shared config.
	api.post(
		'/auth/login',
		asyncHandler( async ( req: Request, res: Response ) => {
			const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
			if ( ! token ) {
				res.status( 400 ).json( { error: 'token required' } );
				return;
			}
			let me: { ID: number; email: string; display_name: string };
			try {
				const meResponse = await fetch(
					'https://public-api.wordpress.com/rest/v1.1/me?fields=ID,email,display_name',
					{ headers: { Authorization: `Bearer ${ token }` } }
				);
				if ( ! meResponse.ok ) {
					res.status( 401 ).json( { error: 'Invalid authentication token' } );
					return;
				}
				me = ( await meResponse.json() ) as { ID: number; email: string; display_name: string };
			} catch ( error ) {
				console.error( 'Auth login: failed to reach WordPress.com:', error );
				res.status( 502 ).json( { error: 'Could not reach WordPress.com to validate the token.' } );
				return;
			}
			await updateSharedConfig( {
				authToken: {
					accessToken: token,
					id: me.ID,
					email: me.email,
					displayName: me.display_name,
					expiresIn: DEFAULT_TOKEN_LIFETIME_MS / 1000,
					expirationTime: Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
				},
			} );
			res.json( { id: me.ID, email: me.email, displayName: me.display_name } );
		} )
	);

	// Log out: best-effort revoke the token on WordPress.com (like the CLI), then
	// clear it from the shared config.
	api.post(
		'/auth/logout',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( token?.accessToken ) {
				await fetch( 'https://public-api.wordpress.com/wpcom/v2/studio-app/token', {
					method: 'DELETE',
					headers: { Authorization: `Bearer ${ token.accessToken }` },
				} ).catch( () => undefined );
			}
			await updateSharedConfig( { authToken: undefined } );
			res.status( 204 ).end();
		} )
	);

	// --- Agent instructions — the shared ~/.studio/knowledge/instructions.md --
	api.get(
		'/agent-instructions',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( { content: ( await readGlobalInstructionsFile() ) ?? '' } );
		} )
	);

	api.post(
		'/agent-instructions',
		asyncHandler( async ( req: Request, res: Response ) => {
			const content = req.body?.content;
			if ( typeof content !== 'string' ) {
				res.status( 400 ).json( { error: 'content required' } );
				return;
			}
			await writeGlobalInstructions( content );
			res.status( 204 ).end();

			// Only a save that ends an edit session counts, not the debounced autosaves.
			const previousContent = req.body?.editSession?.previousContent;
			if ( typeof previousContent === 'string' && previousContent !== content ) {
				trackEvent( TRACKS_EVENTS.SETTING_INSTRUCTIONS_CHANGE, {
					has_content: content.trim().length > 0,
					length_bucket: getInstructionsLengthBucket( content ),
					surface: 'settings',
				} );
			}
		} )
	);

	// --- AI settings — provider + Anthropic API key in shared.json ------------
	api.get(
		'/ai-settings',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( await readAiSettings() );
		} )
	);

	// Clearing the key also falls the provider back to WordPress.com, so both writes
	// report through one event, as on the desktop.
	function trackAiSettingsChange( previous: AiSettings, next: AiSettings ): void {
		const unchanged =
			previous.provider === next.provider &&
			previous.hasAnthropicApiKey === next.hasAnthropicApiKey &&
			previous.anthropicApiKeyPreview === next.anthropicApiKeyPreview;
		if ( unchanged ) {
			return;
		}
		trackEvent( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			provider: next.provider,
			has_anthropic_api_key: next.hasAnthropicApiKey,
			surface: 'settings',
		} );
	}

	// Write-only: responses carry a truncated preview, never the key. A key
	// Anthropic rejects answers 400 and is not stored.
	api.put(
		'/ai-settings',
		asyncHandler( async ( req: Request, res: Response ) => {
			const key = req.body?.anthropicApiKey;
			if ( key !== null && typeof key !== 'string' ) {
				res.status( 400 ).json( { error: 'anthropicApiKey must be a string or null' } );
				return;
			}
			const previous = await readAiSettings();
			const settings = await saveAnthropicApiKey( key );
			res.json( settings );
			trackAiSettingsChange( previous, settings );
		} )
	);

	// Answers 400 when Anthropic rejects the saved key, so the UI keeps its
	// toggle off.
	api.put(
		'/ai-settings/provider',
		asyncHandler( async ( req: Request, res: Response ) => {
			const provider = req.body?.provider;
			if ( typeof provider !== 'string' || ! isAiProviderId( provider ) ) {
				res.status( 400 ).json( { error: 'provider must be a known AI provider id' } );
				return;
			}
			const previous = await readAiSettings();
			const settings = await setAiProvider( provider );
			res.json( settings );
			trackAiSettingsChange( previous, settings );
		} )
	);

	// --- Sites — the local machine's real Studio sites, via the CLI -----------
	api.get(
		'/sites',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const [ sites, sortOrders ] = await Promise.all( [
				listSites( execute ),
				readSiteSortOrders(),
			] );
			res.json( sites.map( ( site ) => toSiteDetails( site, sortOrders.get( site.id ) ) ) );
		} )
	);

	// Declared before `/sites/:id/*` so the literal path wins the match.
	api.post(
		'/sites/sort-order',
		asyncHandler( async ( req: Request, res: Response ) => {
			const parsed = z
				.object( {
					updates: z.array( z.object( { siteId: z.string(), sortOrder: z.number() } ) ),
				} )
				.safeParse( req.body );
			if ( ! parsed.success ) {
				res.status( 400 ).json( { error: 'updates required' } );
				return;
			}
			await writeSiteSortOrders( parsed.data.updates );
			res.status( 204 ).end();
		} )
	);

	api.post(
		'/sites/:id/start',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sites = await listSites( execute );
			const site = sites.find( ( candidate ) => candidate.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			await startSite( execute, site.path );
			res.sendStatus( 204 );
		} )
	);

	api.post(
		'/sites/:id/stop',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sites = await listSites( execute );
			const site = sites.find( ( candidate ) => candidate.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			await stopSite( execute, site.path );
			res.sendStatus( 204 );
		} )
	);

	// Both of these read straight from cli.json via `readSitePath` rather than
	// forking the CLI for a site list: the UI asks for them on every site
	// switch, and a fork costs about a second of CPU each time.
	api.get(
		'/sites/:id/wp-version',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sitePath = await readSitePath( req.params.id );
			if ( ! sitePath ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			res.json( { wpVersion: getWordPressVersion( sitePath ) } );
		} )
	);

	api.get(
		'/sites/:id/storage',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sitePath = await readSitePath( req.params.id );
			if ( ! sitePath ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			// Walking a site takes long enough that the client often navigates
			// away first. Tie the walk to the request so an abandoned one stops
			// instead of running to completion for nobody.
			const controller = new AbortController();
			req.on( 'close', () => controller.abort() );
			try {
				res.json( await measureSiteStorage( sitePath, { signal: controller.signal } ) );
			} catch ( error ) {
				if ( controller.signal.aborted ) {
					return;
				}
				throw error;
			}
		} )
	);

	// --- Site creation helpers + create ---------------------------------------
	// Pure server-side filesystem logic (the server runs on the user's machine),
	// plus the CLI `create`. The browser has no native folder picker, so the UI
	// proposes/edits the path as text (see capabilities.nativeFolderPicker).
	api.get(
		'/site-defaults/name',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sites = await listSites( execute );
			const baseName = typeof req.query.base === 'string' ? req.query.base : undefined;
			const usedNames = sites.map( ( site ) => site.name );
			const name = baseName
				? await generateNumberedName( baseName, usedNames, sitesRoot )
				: await generateSiteName( usedNames, sitesRoot );
			res.json( { name } );
		} )
	);

	api.get(
		'/site-defaults/path',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sitePath = path.join( sitesRoot, sanitizeFolderName( String( req.query.name ?? '' ) ) );
			try {
				res.json( {
					path: sitePath,
					isEmpty: await isEmptyDir( sitePath ),
					isWordPress: isWordPressDirectory( sitePath ),
				} );
			} catch ( err ) {
				if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
					res.json( { path: sitePath, isEmpty: true, isWordPress: false } );
				} else if ( isErrnoException( err ) && err.code === 'ENAMETOOLONG' ) {
					res.json( { path: sitePath, isEmpty: false, isWordPress: false, isNameTooLong: true } );
				} else {
					throw err;
				}
			}
		} )
	);

	api.post( '/paths/compare', ( req: Request, res: Response ) => {
		const { path1, path2 } = req.body as { path1?: string; path2?: string };
		// Confine both operands to `sitesRoot` before any filesystem access; nothing
		// outside it can be a site, so a non-match is the correct answer.
		const confined1 = path1 ? confineToRoot( sitesRoot, path1 ) : null;
		const confined2 = path2 ? confineToRoot( sitesRoot, path2 ) : null;
		const equal = !! confined1 && !! confined2 && arePathsEqual( confined1, confined2 );
		res.json( { equal } );
	} );

	api.post(
		'/sites',
		asyncHandler( async ( req: Request, res: Response ) => {
			const body = req.body as {
				name?: string;
				path?: string;
				phpVersion?: string;
				wpVersion?: string;
				customDomain?: string;
				enableHttps?: boolean;
				adminUsername?: string;
				adminPassword?: string;
				adminEmail?: string;
				skipStart?: boolean;
				// Optional Blueprint to apply on creation: `blueprint` is the parsed
				// blueprint JSON; `filePath` (set for uploaded ZIP bundles) lets the
				// CLI resolve relative assets.
				blueprint?: {
					blueprint?: SiteCreateOptions[ 'blueprint' ];
					slug?: string;
					filePath?: string;
				};
			};
			if ( ! body.name || ! body.path ) {
				res.status( 400 ).json( { error: 'name and path are required' } );
				return;
			}
			const siteId = crypto.randomUUID();
			// Build the create args with the same shared helper the desktop uses, so
			// Blueprints (and --wp dev→nightly, etc.) are handled identically.
			let cleanupCreateArgs: () => void = () => undefined;
			try {
				const { args, cleanup } = buildSiteCreateArgs( {
					path: body.path,
					name: body.name,
					siteId,
					wpVersion: body.wpVersion,
					phpVersion: body.phpVersion,
					customDomain: body.customDomain,
					enableHttps: body.enableHttps,
					adminUsername: body.adminUsername,
					adminPassword: body.adminPassword,
					adminEmail: body.adminEmail,
					noStart: body.skipStart,
					blueprint: body.blueprint?.blueprint,
					originalBlueprintPath: body.blueprint?.filePath,
				} );
				cleanupCreateArgs = cleanup;
				await new Promise< void >( ( resolve, reject ) => {
					const [ emitter ] = execute( args, { output: 'capture' } );
					emitter.on( 'success', () => resolve() );
					emitter.on( 'failure', ( { error } ) => reject( error ) );
					emitter.on( 'error', ( { error } ) => reject( error ) );
				} );
			} finally {
				cleanupCreateArgs();
				if ( body.blueprint?.filePath ) {
					await cleanupBlueprintTempDir( path.dirname( body.blueprint.filePath ) ).catch(
						() => undefined
					);
				}
			}

			const created = ( await listSites( execute ) ).find( ( s ) => s.id === siteId );
			if ( ! created ) {
				res.status( 500 ).json( { error: 'Site was created but could not be found.' } );
				return;
			}
			res.json( toSiteDetails( created ) );
		} )
	);

	// Delete a site (and, by default, its files) — the CLI `site delete` the
	// desktop uses. The connector passes ?deleteFiles=false to keep the files.
	api.delete(
		'/sites/:id',
		asyncHandler( async ( req: Request, res: Response ) => {
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			const keepFiles = req.query.deleteFiles === 'false';
			await new Promise< void >( ( resolve, reject ) => {
				const [ emitter ] = execute(
					[ 'site', 'delete', '--path', site.path, keepFiles ? '--no-files' : '--files' ],
					{ output: 'capture' }
				);
				emitter.on( 'success', () => resolve() );
				emitter.on( 'failure', ( { error } ) => reject( error ) );
				emitter.on( 'error', ( { error } ) => reject( error ) );
			} );
			res.status( 204 ).end();
		} )
	);

	// Edit a site's settings — the same CLI `site set` the desktop uses, built
	// from the shared arg builder. Mirrors the desktop's diff: only changed
	// fields are forwarded (the agentic UI doesn't edit runtime/file-access).
	api.post(
		'/sites/:id/update',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { site: updated, wpVersion } = ( req.body ?? {} ) as {
				site?: Partial< SiteListItem >;
				wpVersion?: string;
			};
			const current = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! current ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			if ( ! updated ) {
				res.status( 400 ).json( { error: 'Missing site payload' } );
				return;
			}

			const options: EditSiteOptions = { path: current.path, siteId: current.id };
			if ( updated.name !== undefined && updated.name !== current.name ) {
				options.name = updated.name;
			}
			if ( ( updated.customDomain ?? '' ) !== ( current.customDomain ?? '' ) ) {
				options.domain = updated.customDomain ?? '';
			}
			if ( ( updated.enableHttps ?? false ) !== ( current.enableHttps ?? false ) ) {
				options.https = updated.enableHttps ?? false;
			}
			if ( updated.phpVersion !== undefined && updated.phpVersion !== current.phpVersion ) {
				options.php = updated.phpVersion;
			}
			if ( wpVersion ) {
				options.wp = isWordPressDevVersion( wpVersion ) ? 'nightly' : wpVersion;
			}
			if ( ( updated.enableXdebug ?? false ) !== ( current.enableXdebug ?? false ) ) {
				options.xdebug = updated.enableXdebug ?? false;
			}
			if ( ( updated.adminUsername ?? 'admin' ) !== ( current.adminUsername ?? 'admin' ) ) {
				options.adminUsername = updated.adminUsername;
			}
			if ( ( updated.adminPassword ?? '' ) !== ( current.adminPassword ?? '' ) ) {
				// The CLI expects a plaintext password (it encodes before saving).
				options.adminPassword = decodePassword( updated.adminPassword ?? '' );
			}
			if ( ( updated.adminEmail ?? '' ) !== ( current.adminEmail ?? '' ) ) {
				options.adminEmail = updated.adminEmail;
			}
			if ( ( updated.enableDebugLog ?? false ) !== ( current.enableDebugLog ?? false ) ) {
				options.debugLog = updated.enableDebugLog ?? false;
			}
			if ( ( updated.enableDebugDisplay ?? false ) !== ( current.enableDebugDisplay ?? false ) ) {
				options.debugDisplay = updated.enableDebugDisplay ?? false;
			}

			// More than path + siteId means a real change to apply.
			if ( Object.keys( options ).length > 2 ) {
				await new Promise< void >( ( resolve, reject ) => {
					const [ emitter ] = execute( buildSiteSetArgs( options ), { output: 'capture' } );
					emitter.on( 'success', () => resolve() );
					emitter.on( 'failure', ( { error } ) => reject( error ) );
					emitter.on( 'error', ( { error } ) => reject( error ) );
				} );
			}
			const [ sites, sortOrders ] = await Promise.all( [
				listSites( execute ),
				readSiteSortOrders(),
			] );
			const refreshed = sites.find( ( s ) => s.id === req.params.id );
			res.json( toSiteDetails( refreshed ?? current, sortOrders.get( req.params.id ) ) );
		} )
	);

	// Duplicate a site: copy its folder, then register the copy via the CLI
	// `create`, which adopts the existing WordPress files (only core is
	// refreshed; the copied wp-content + database are preserved).
	api.post(
		'/sites/:id/copy',
		asyncHandler( async ( req: Request, res: Response ) => {
			const sites = await listSites( execute );
			const source = sites.find( ( s ) => s.id === req.params.id );
			if ( ! source ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			// `<name> Copy`, bumped to `Copy 2`, `Copy 3`… — mirrors the desktop.
			const newName = await generateNumberedName(
				`${ source.name } Copy`,
				sites.map( ( s ) => s.name ),
				sitesRoot
			);
			const newPath = path.join( sitesRoot, sanitizeFolderName( newName ) );
			const newId = crypto.randomUUID();
			await recursiveCopyDirectory( source.path, newPath );

			// Build the copy's create args with the same shared helper createSite
			// uses (no blueprint here, so there's nothing to clean up).
			const { args } = buildSiteCreateArgs( {
				path: newPath,
				name: newName,
				siteId: newId,
				phpVersion: source.phpVersion,
				adminUsername: source.adminUsername || undefined,
				adminPassword: source.adminPassword ? decodePassword( source.adminPassword ) : undefined,
				adminEmail: source.adminEmail || undefined,
			} );
			await new Promise< void >( ( resolve, reject ) => {
				const [ emitter ] = execute( args, { output: 'capture' } );
				emitter.on( 'success', () => resolve() );
				emitter.on( 'failure', ( { error } ) => reject( error ) );
				emitter.on( 'error', ( { error } ) => reject( error ) );
			} );

			const created = ( await listSites( execute ) ).find( ( s ) => s.id === newId );
			// The copied database still points at the source site's URL, so the copy
			// would 301-redirect back to the source. Rewrite the URL across the DB to
			// the copy's own — the same search-replace the desktop's updateSiteUrl does.
			if ( created?.url && source.url && created.url !== source.url ) {
				await new Promise< void >( ( resolve, reject ) => {
					const [ emitter ] = execute(
						[
							'wp',
							'--path',
							newPath,
							'search-replace',
							source.url,
							created.url,
							'--skip-columns=guid',
						],
						{ output: 'capture' }
					);
					emitter.on( 'success', () => resolve() );
					emitter.on( 'failure', ( { error } ) => reject( error ) );
					emitter.on( 'error', ( { error } ) => reject( error ) );
				} );
			}
			res.json( toSiteDetails( created ?? source ) );
		} )
	);

	// Export a site to a backup file. The browser has no native Save-As dialog,
	// so the server exports to a temp file via the CLI and streams it back as a
	// download (the connector turns it into a browser download).
	api.get(
		'/sites/:id/export',
		asyncHandler( async ( req: Request, res: Response ) => {
			const mode = req.query.mode === 'database' ? 'db' : 'full';
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			const dir = mkdtempSync( path.join( os.tmpdir(), 'studio-export-' ) );
			const filename = `${ backupFilename( site.name ) }.${ mode === 'db' ? 'sql' : 'tar.gz' }`;
			const dest = path.join( dir, filename );
			const cleanup = () => rm( dir, { recursive: true, force: true }, () => undefined );
			try {
				await new Promise< void >( ( resolve, reject ) => {
					const [ emitter ] = execute( [ 'export', '--path', site.path, dest, '--mode', mode ], {
						output: 'capture',
					} );
					emitter.on( 'success', () => resolve() );
					emitter.on( 'failure', ( { error } ) => reject( error ) );
					emitter.on( 'error', ( { error } ) => reject( error ) );
				} );
			} catch ( error ) {
				cleanup();
				throw error;
			}
			res.download( dest, filename, () => cleanup() );
		} )
	);

	// --- File uploads + import + local media ----------------------------------
	// The browser can't hand the server a filesystem path, so it streams the file
	// bytes here; the server saves them to a temp file and returns its path. That
	// path then flows into the same path-based CLI operations the desktop uses
	// (import a backup, etc.). The raw body streams straight to disk — Express's
	// JSON parser ignores the non-JSON content type, so the stream is intact.
	api.post(
		'/uploads',
		asyncHandler( async ( req: Request, res: Response ) => {
			// `path.basename` strips any directory components, so the (untrusted)
			// name can't escape the unique temp dir; the extension is preserved so
			// the importer can infer the backup type.
			const rawName = typeof req.query.name === 'string' ? req.query.name : '';
			const safeName = path.basename( rawName ) || 'upload';
			const dir = mkdtempSync( path.join( os.tmpdir(), 'studio-upload-' ) );
			const dest = path.join( dir, safeName );
			try {
				await pipeline( req, createWriteStream( dest ) );
			} catch ( error ) {
				rm( dir, { recursive: true, force: true }, () => undefined );
				throw error;
			}
			uploads.set( dest, { path: dest, directory: dir } );
			res.json( { path: dest } );
		} )
	);

	api.post(
		'/blueprints/extract',
		asyncHandler( async ( req: Request, res: Response ) => {
			res.json( await extractBlueprintUpload( req ) );
		} )
	);

	api.post(
		'/blueprints/cleanup',
		asyncHandler( async ( req: Request, res: Response ) => {
			const tempDir = req.body?.tempDir;
			if ( typeof tempDir === 'string' && tempDir ) {
				await cleanupBlueprintTempDir( tempDir );
			}
			res.status( 204 ).end();
		} )
	);

	// Import a backup into an already-created site. Uploaded files are cleaned up
	// after each attempt, so a retry must upload the selected File again.
	api.post(
		'/sites/:id/import',
		asyncHandler( async ( req: Request, res: Response ) => {
			const requestedPath = req.body?.path;
			if ( typeof requestedPath !== 'string' ) {
				res.status( 400 ).json( { error: 'Missing backup path' } );
				return;
			}
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			const upload = uploads.get( requestedPath );
			if ( ! upload ) {
				res.status( 400 ).json( { error: 'Unknown backup path' } );
				return;
			}
			uploads.delete( requestedPath );
			try {
				await new Promise< void >( ( resolve, reject ) => {
					const [ emitter ] = execute(
						// Onboarding imports are part of the add-site flow, which `studio_site_imported`
						// deliberately does not count.
						[
							'import',
							'--path',
							site.path,
							upload.path,
							'--start-server',
							'--suppress-tracks-event',
						],
						{ output: 'capture' }
					);
					emitter.on( 'data', ( { data } ) => {
						const parsed = importIpcEventSchema.safeParse( data );
						if ( parsed.success ) {
							sseSend( {
								channel: 'import',
								payload: { siteId: site.id, event: parsed.data.event },
							} );
						}
					} );
					emitter.on( 'success', () => resolve() );
					emitter.on( 'failure', ( { error } ) => reject( error ) );
					emitter.on( 'error', ( { error } ) => reject( error ) );
				} );
			} finally {
				rm( upload.directory, { recursive: true, force: true }, () => undefined );
			}
			res.status( 204 ).end();
		} )
	);

	// NOTE: there is intentionally no `/media/read` endpoint. Streaming an
	// arbitrary local file by absolute path over HTTP is an arbitrary-read risk
	// (the API is reachable cross-origin from the browser), and nothing in the UI
	// consumes it yet. The connector's `readLocalMediaFile` throws until a real
	// consumer and a path-containment policy (e.g. restricted to the sites root)
	// exist.

	// --- Open in OS: folder / editor / terminal + app detection ---------------
	// The browser can't reach the filesystem, but the server runs on the user's
	// machine, so it opens paths in OS apps on the browser's behalf.

	// Editors + terminals detected on disk, so the preferences picker only offers
	// what's actually installed.
	api.get(
		'/installed-apps',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( detectInstalledApps() );
		} )
	);

	// --- Global preferences — the same app.json/shared.json the desktop uses ---
	api.get(
		'/user-preferences',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( await readUserPreferences( preferencesContext() ) );
		} )
	);

	api.patch(
		'/user-preferences',
		asyncHandler( async ( req: Request, res: Response ) => {
			const parsed = userPreferencesPatchSchema.safeParse( req.body ?? {} );
			if ( ! parsed.success ) {
				res.status( 400 ).json( { error: 'Invalid preferences' } );
				return;
			}
			await writeUserPreferences( parsed.data );
			res.status( 204 ).end();
		} )
	);

	api.post(
		'/sites/:id/open-folder',
		asyncHandler( async ( req: Request, res: Response ) => {
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			await openPath( site.path );
			res.status( 204 ).end();
		} )
	);

	api.post(
		'/sites/:id/open-in-editor',
		asyncHandler( async ( req: Request, res: Response ) => {
			const editor =
				req.body?.editor ?? ( await readUserPreferences( preferencesContext() ) ).editor;
			if ( typeof editor !== 'string' || ! isEditor( editor ) ) {
				res.status( 400 ).json( { error: `Unsupported editor: ${ String( editor ) }` } );
				return;
			}
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			await openInEditor( editor, site.path );
			res.status( 204 ).end();
		} )
	);

	api.post(
		'/sites/:id/open-in-terminal',
		asyncHandler( async ( req: Request, res: Response ) => {
			const requested =
				req.body?.terminal ?? ( await readUserPreferences( preferencesContext() ) ).terminal;
			// No preference (or an unknown one) falls back to the system terminal.
			const terminal =
				typeof requested === 'string' && isTerminal( requested ) ? requested : 'terminal';
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			await openInTerminal( terminal, site.path );
			res.status( 204 ).end();
		} )
	);

	// Studio Code AI quota for the signed-in account, proxied through the
	// server so the browser UI can show usage-cap messaging (e.g. the reset
	// date) without holding the wpcom token. `null` when signed out or the
	// quota can't be fetched — callers fall back to static copy.
	api.get(
		'/quota',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const token = await readAuthToken();
			res.json( token?.accessToken ? await fetchStudioAssistantQuota( token.accessToken ) : null );
		} )
	);

	// AI credit top-up options priced for the signed-in account, proxied for
	// the same reason as the quota. `null` when signed out or pricing can't be
	// fetched — callers fall back to the single fixed top-up.
	api.get(
		'/top-up-pricing',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const token = await readAuthToken();
			res.json(
				token?.accessToken ? await fetchStudioAssistantTopUpPricing( token.accessToken ) : null
			);
		} )
	);

	// --- WordPress.com sync: connected + syncable sites -----------------------
	// All backed by the same @studio/common code the desktop uses. Reads the
	// shared auth token (the user logs in via `studio auth login`).
	api.get(
		'/wpcom/syncable-sites',
		asyncHandler( async ( _req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.json( [] );
				return;
			}
			res.json( await fetchSyncableSites( token.accessToken ) );
		} )
	);

	api.get(
		'/wpcom/connected-sites',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( await getAllConnectedWpcomSitesForCurrentUser() );
		} )
	);

	api.get(
		'/sites/:id/connected-sites',
		asyncHandler( async ( req: Request, res: Response ) => {
			res.json( await getConnectedWpcomSitesForLocalSite( req.params.id ) );
		} )
	);

	api.post(
		'/sites/:id/connected-sites',
		asyncHandler( async ( req: Request, res: Response ) => {
			const site = req.body as SyncSite;
			res.json( await addConnectedWpcomSite( req.params.id, site ) );
		} )
	);

	api.delete(
		'/sites/:id/connected-sites/:remoteSiteId',
		asyncHandler( async ( req: Request, res: Response ) => {
			await removeConnectedWpcomSite( req.params.id, Number( req.params.remoteSiteId ) );
			res.sendStatus( 204 );
		} )
	);

	// --- Preview sites (snapshots) --------------------------------------------
	// Kick off the CLI command and return its operationId immediately; progress
	// + the final url/success stream over the SSE `snapshot` channel.
	api.get(
		'/snapshots',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( await fetchSnapshots( execute ) );
		} )
	);

	api.post(
		'/sites/:id/preview',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { hostname, name } = req.body as { hostname?: string; name?: string };
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			// A hostname means "refresh this existing preview"; otherwise create one.
			const { operationId } = hostname
				? snapshotManager.updateSnapshot( site.path, hostname )
				: snapshotManager.createSnapshot( site.path, name );
			res.json( { operationId } );
		} )
	);

	api.delete( '/snapshots/:hostname', ( req: Request, res: Response ) => {
		const { operationId } = snapshotManager.deleteSnapshot( req.params.hostname );
		res.json( { operationId } );
	} );

	// --- Sync: pull from a connected WordPress.com live site ------------------
	api.post(
		'/sites/:id/pull',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { remoteSiteId, options } = req.body as {
				remoteSiteId?: number;
				options?: PullSyncOptions;
			};
			if ( ! remoteSiteId ) {
				res.status( 400 ).json( { error: 'remoteSiteId is required' } );
				return;
			}
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			const release = registerSyncAbort( req.params.id, remoteSiteId );
			try {
				await pullSite(
					execute,
					site.path,
					remoteSiteId,
					( progress ) => {
						sseSend( {
							channel: 'sync-pull',
							payload: { ...progress, siteId: req.params.id, remoteSiteId },
						} );
					},
					options,
					release.signal
				);
			} catch ( error ) {
				// A user cancel is an intentional stop, not a server error — report it
				// as a result so it doesn't surface as a 500.
				if ( ! isSyncCancelledError( error ) ) {
					throw error;
				}
				res.json( { cancelled: true } );
				return;
			} finally {
				release();
			}
			res.json( { cancelled: false } );
		} )
	);

	// Stop an in-flight push or pull. No-op when nothing is running for the site,
	// and the operation itself refuses to stop once it has moved past its point
	// of no return (see `canCancelPush` / `canCancelPull`).
	api.post(
		'/sites/:id/sync/cancel',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { remoteSiteId } = req.body as { remoteSiteId?: number };
			if ( ! remoteSiteId ) {
				res.status( 400 ).json( { error: 'remoteSiteId is required' } );
				return;
			}
			SYNC_ABORT_CONTROLLERS.get( `${ req.params.id }-${ remoteSiteId }` )?.abort();
			res.sendStatus( 204 );
		} )
	);

	// Selective-sync lookups for the agentic UI's sync dialog: the latest
	// backup (rewind) id, the remote backup file tree under it, and the live
	// site's hosting PHP version.
	api.get(
		'/wpcom/sites/:remoteSiteId/latest-rewind-id',
		asyncHandler( async ( req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.status( 401 ).json( { error: 'Authentication required.' } );
				return;
			}
			// No backup yet (or lookup failure) rejects and surfaces as a 500 via
			// the error middleware — the dialog needs the error state to disable
			// per-item selection and force a full sync, like the classic renderer.
			res.json( await fetchLatestRewindId( token.accessToken, Number( req.params.remoteSiteId ) ) );
		} )
	);

	api.get(
		'/wpcom/sites/:remoteSiteId/remote-file-tree',
		asyncHandler( async ( req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.status( 401 ).json( { error: 'Authentication required.' } );
				return;
			}
			const { rewindId, path: treePath } = req.query as { rewindId?: string; path?: string };
			if ( ! rewindId || ! treePath ) {
				res.status( 400 ).json( { error: 'rewindId and path are required' } );
				return;
			}
			const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
			const rawResponse = await wpcom.req.post( {
				path: `/sites/${ Number( req.params.remoteSiteId ) }/rewind/backup/ls`,
				apiNamespace: 'wpcom/v2',
				body: { backup_id: rewindId, path: treePath },
			} );
			const parsed = z
				.object( {
					ok: z.boolean(),
					error: z.string().optional(),
					contents: z.record( z.string(), z.unknown() ).optional(),
				} )
				.parse( rawResponse );
			if ( ! parsed.ok ) {
				res.status( 502 ).json( { error: parsed.error || 'Failed to fetch remote file tree' } );
				return;
			}
			res.json( parsed.contents ?? {} );
		} )
	);

	api.get(
		'/wpcom/sites/:remoteSiteId/hosting-php-version',
		asyncHandler( async ( req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.status( 401 ).json( { error: 'Authentication required.' } );
				return;
			}
			try {
				const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
				const response = await wpcom.req.get( {
					apiNamespace: 'wpcom/v2',
					path: `/sites/${ Number( req.params.remoteSiteId ) }/hosting/php-version`,
				} );
				res.json( z.string().parse( response ) );
			} catch {
				res.json( null );
			}
		} )
	);

	// Push the local site to its connected WordPress.com live site. Long-running
	// (export → upload → import); progress streams on the SSE `sync` channel.
	// Responds once the remote import has finished.
	api.post(
		'/sites/:id/push',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { remoteSiteId, options } = req.body as {
				remoteSiteId?: number;
				options?: PushSyncOptions;
			};
			if ( ! remoteSiteId ) {
				res.status( 400 ).json( { error: 'remoteSiteId is required' } );
				return;
			}
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.status( 401 ).json( { error: 'Authentication required to push.' } );
				return;
			}
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === req.params.id );
			if ( ! site ) {
				res.status( 404 ).json( { error: `Site ${ req.params.id } not found` } );
				return;
			}
			const release = registerSyncAbort( req.params.id, remoteSiteId );
			try {
				await pushSite(
					{
						executeCliCommand: execute,
						accessToken: token.accessToken,
						emit: ( output ) =>
							sseSend( {
								channel: 'sync-push',
								payload: { ...output, siteId: req.params.id, remoteSiteId },
							} ),
					},
					{ sitePath: site.path, remoteSiteId, options, signal: release.signal }
				);
			} catch ( error ) {
				if ( ! isSyncCancelledError( error ) ) {
					throw error;
				}
				res.json( { cancelled: true } );
				return;
			} finally {
				release();
			}
			res.json( { cancelled: false } );
		} )
	);

	// Start watching for the WordPress.com site the user is about to create in the
	// "Create new" checkout tab (the local analog of the desktop's deep link). The
	// new site, once it appears in the account, is reported on the `sync-connect`
	// SSE channel; this responds immediately while the watch runs in the background.
	api.post(
		'/sites/:id/watch-published-site',
		asyncHandler( async ( req: Request, res: Response ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				res.status( 401 ).json( { error: 'Authentication required.' } );
				return;
			}
			const studioSiteId = req.params.id;
			const site = ( await listSites( execute ) ).find( ( s ) => s.id === studioSiteId );
			const expectedName = site?.customDomain ?? site?.name ?? '';
			const knownIds = new Set(
				( await fetchSyncableSites( token.accessToken ) ).map( ( s ) => s.id )
			);
			startPublishWatch( studioSiteId, expectedName, token.accessToken, knownIds );
			res.sendStatus( 202 );
		} )
	);

	// --- AI sessions ----------------------------------------------------------
	api.get(
		'/sessions',
		asyncHandler( async ( _req: Request, res: Response ) => {
			res.json( await listHydratedAiSessions( sessionsRoot ) );
		} )
	);

	api.post(
		'/sessions',
		asyncHandler( async ( req: Request, res: Response ) => {
			// Bind the new chat to the requested local site (the same way the
			// desktop does), so "new chat" on a site is placed under it. An empty
			// existing draft for that site is reused instead of piling up orphans.
			const { siteId } = req.body as { siteId?: string };
			let site;
			if ( siteId ) {
				const found = ( await listSites( execute ) ).find( ( s ) => s.id === siteId );
				if ( found ) {
					site = { id: found.id, name: found.name, path: found.path };
				}
			}
			// `created` is an analytics signal, not part of the session shape.
			const { created, ...summary } = await createOrReuseAiSession( sessionsRoot, {
				site,
			} );
			res.json( summary );

			// Created in-process here, as in the desktop's Main. Reused drafts don't count.
			if ( created ) {
				trackEvent( TRACKS_EVENTS.CODE_SESSION_CREATED, {
					...getAiTracksIdentity( summary.id ),
					has_site: Boolean( site ),
				} );
			}
		} )
	);

	api.get(
		'/sessions/:id',
		asyncHandler( async ( req: Request, res: Response ) => {
			res.json( await loadHydratedAiSession( sessionsRoot, req.params.id ) );
		} )
	);

	api.delete(
		'/sessions/:id',
		asyncHandler( async ( req: Request, res: Response ) => {
			const deleted = await deleteAiSession( sessionsRoot, req.params.id );
			await deleteSharedSession( deleted.id );
			await deleteAiSessionPlacement( deleted.id );
			res.sendStatus( 204 );
		} )
	);

	api.patch(
		'/sessions/:id',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { summary } = await loadAiSession( sessionsRoot, req.params.id );
			const patch = req.body as { archived?: boolean };
			const [ metadata, placement ] = await Promise.all( [
				updateSharedSession( summary.id, patch ),
				readAiSessionPlacement( summary.id ),
			] );
			res.json( hydrateAiSessionSummary( summary, metadata, placement ) );
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
			await appendModelChangeEntry( sessionsRoot, req.params.id, '', model );
			res.sendStatus( 204 );
		} )
	);

	api.post(
		'/sessions/:id/provider',
		asyncHandler( async ( req: Request, res: Response ) => {
			const { provider, model } = req.body as { provider?: string; model?: string };
			if ( ! provider || ! isAiProviderId( provider ) ) {
				res.status( 400 ).json( { error: `Unknown AI provider: ${ provider }` } );
				return;
			}
			if ( ! model || ! isAiModelId( model ) || ! providerServesModel( provider, model ) ) {
				res.status( 400 ).json( { error: `Model ${ model } is not served by ${ provider }` } );
				return;
			}
			await appendStudioEntry( sessionsRoot, req.params.id, 'studio.session_context', {
				provider,
				model,
			} );
			res.sendStatus( 204 );
		} )
	);

	api.post( '/sessions/:id/messages', ( req: Request, res: Response ) => {
		const { prompt, displayMessage } = req.body as { prompt?: string; displayMessage?: string };
		if ( ! prompt ) {
			res.status( 400 ).json( { error: 'prompt is required' } );
			return;
		}
		const { runId } = runManager.startAgentRun( {
			sessionId: req.params.id,
			prompt: expandSkillCommandPrompt( prompt ),
			displayMessage,
		} );
		res.json( { runId } );
	} );

	// --- Runs -----------------------------------------------------------------
	api.get( '/runs/active', ( _req: Request, res: Response ) => {
		res.json( runManager.listActiveAgentRuns() );
	} );

	api.post( '/runs/:runId/interrupt', ( req: Request, res: Response ) => {
		runManager.interruptAgentRun( req.params.runId );
		res.sendStatus( 204 );
	} );

	api.post( '/runs/:runId/answer', ( req: Request, res: Response ) => {
		const { answers } = req.body as { answers?: Record< string, string > };
		runManager.answerAgentRun( req.params.runId, answers ?? {} );
		res.sendStatus( 204 );
	} );

	app.use( '/api', api );

	// OAuth redirect target for the browser login flow (registered before the SPA
	// fallback so it isn't swallowed by it).
	app.get( '/auth/callback', ( _req: Request, res: Response ) => {
		res.setHeader( 'Content-Type', 'text/html; charset=utf-8' );
		res.send( AUTH_CALLBACK_HTML );
	} );

	// --- Web UI ---------------------------------------------------------------
	const uiIndex = uiDist ? path.join( uiDist, 'index.local.html' ) : undefined;
	const hasUi = !! uiIndex && existsSync( uiIndex );
	if ( uiDist && hasUi ) {
		app.use( express.static( uiDist ) );
		// SPA fallback: the app uses real-path routing, so any unmatched HTML
		// navigation reloads into the app shell. API routes keep precedence.
		app.get( '*', ( req: Request, res: Response, next ) => {
			if ( ( req.headers.accept ?? '' ).includes( 'text/html' ) ) {
				res.sendFile( uiIndex! );
				return;
			}
			next();
		} );
	}

	app.use( ( err: unknown, _req: Request, res: Response, _next: ( e?: unknown ) => void ) => {
		if ( err instanceof InvalidAnthropicApiKeyError ) {
			res.status( 400 ).json( { error: err.message } );
			return;
		}
		const message = err instanceof Error ? err.message : String( err );
		res.status( 500 ).json( { error: message } );
	} );

	const server = await new Promise< ReturnType< typeof app.listen > >( ( resolve ) => {
		const listening = app.listen( port, host, () => resolve( listening ) );
	} );

	const address = server.address();
	const listeningPort = typeof address === 'object' && address ? address.port : port;
	const url = `http://localhost:${ listeningPort }`;

	return {
		url,
		port: listeningPort,
		async close() {
			cliRunner.killAll();
			for ( const watch of publishWatches.values() ) {
				watch.cancelled = true;
			}
			publishWatches.clear();
			for ( const client of sseClients ) {
				client.end();
			}
			sseClients.clear();
			await new Promise< void >( ( resolve ) => server.close( () => resolve() ) );
		},
	};
}
