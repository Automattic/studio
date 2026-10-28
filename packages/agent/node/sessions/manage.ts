import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import {
	deleteSharedSession,
	readSharedSession,
	readSharedSessions,
	updateSharedSession,
} from '@studio/common/lib/shared-config';
import { readSites } from '@studio/common/sites/site-path';
import {
	deleteAiSessionPlacement,
	hydrateAiSessionSummaryWithPlacement,
	readAiSessionPlacement,
	readAiSessionPlacements,
	setAiSessionSitePlacement,
	type AiSessionSitePlacement,
} from '@studio/agent/node/sessions/placement';
import {
	appendStudioEntry,
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '@studio/agent/node/sessions/store';
import {
	deriveEffectiveEnvironment,
	pickLiveSite,
} from '@studio/agent/protocol/sessions/effective-site';
import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import type {
	AiSessionMetadata,
	AiSessionSummary,
	LoadedAiSession,
} from '@studio/agent/protocol/sessions/types';

/**
 * Session listing + creation, hydrated with the metadata that lives outside the
 * session JSONL: the archived, title and unread fields (shared config) and site
 * placement (app.json).
 */

// A local site a session can be bound to.
export interface SessionSite {
	id: string;
	name: string;
	path: string;
}

export function hydrateAiSessionSummary(
	summary: AiSessionSummary,
	metadata?: AiSessionMetadata,
	placement?: AiSessionSitePlacement
): AiSessionSummary {
	return hydrateAiSessionSummaryWithPlacement(
		{
			...summary,
			archived: metadata?.archived,
			title: metadata?.title,
			unread: metadata?.unread,
		},
		placement
	);
}

// Archives, renames, or marks a session read/unread, keeping only the known
// fields so a host can pass a request body straight through.
export async function updateHydratedAiSessionMetadata(
	rootDirectory: string,
	sessionIdOrPrefix: string,
	{ archived, title, unread }: AiSessionMetadata
): Promise< AiSessionSummary > {
	const { summary } = await loadAiSession( rootDirectory, sessionIdOrPrefix );
	const patch = Object.fromEntries(
		Object.entries( { archived, title, unread } ).filter( ( [ , value ] ) => value !== undefined )
	);
	const [ metadata, placement ] = await Promise.all( [
		updateSharedSession( summary.id, patch ),
		readAiSessionPlacement( summary.id ),
	] );
	return hydrateAiSessionSummary( summary, metadata, placement );
}

export async function listHydratedAiSessions(
	rootDirectory: string
): Promise< AiSessionSummary[] > {
	const [ sessions, metadata, placements ] = await Promise.all( [
		listAiSessions( rootDirectory ),
		readSharedSessions(),
		readAiSessionPlacements(),
	] );
	return sessions.map( ( session ) =>
		hydrateAiSessionSummary( session, metadata[ session.id ], placements[ session.id ] )
	);
}

export async function loadHydratedAiSession(
	rootDirectory: string,
	sessionIdOrPrefix: string
): Promise< LoadedAiSession > {
	const session = await loadAiSession( rootDirectory, sessionIdOrPrefix );
	const [ metadata, placement ] = await Promise.all( [
		readSharedSession( session.summary.id ),
		readAiSessionPlacement( session.summary.id ),
	] );
	return {
		...session,
		summary: hydrateAiSessionSummary( session.summary, metadata, placement ),
	};
}

// Match by id OR path: placements may hold either a stale path (site moved) or
// a stale id, and sidebar grouping is transitioning from path- to id-keyed —
// matching both ensures no session is left orphaned by a site deletion.
export async function deleteAiSessionsForSite(
	rootDirectory: string,
	site: Pick< SessionSite, 'id' | 'path' >
): Promise< string[] > {
	const placements = await readAiSessionPlacements();
	const sessionIds = Object.entries( placements )
		.filter(
			( [ , placement ] ) =>
				placement.siteId === site.id || arePathsEqual( placement.sitePath, site.path )
		)
		.map( ( [ sessionId ] ) => sessionId );

	for ( const sessionId of sessionIds ) {
		try {
			await deleteAiSession( rootDirectory, sessionId );
		} catch {
			// A placement can outlive its session file; still drop the metadata.
		}
		try {
			await deleteSharedSession( sessionId );
			await deleteAiSessionPlacement( sessionId );
		} catch {
			// Per-session best effort: one failed config write shouldn't
			// abandon cleanup of the remaining sessions.
		}
	}
	return sessionIds;
}

/**
 * Create a session. When a `site` is given, the session is bound to it
 * (recorded in the session file) and its placement is persisted so the UI shows
 * it under that site.
 */
export async function createHydratedAiSession(
	rootDirectory: string,
	options: { site?: SessionSite } = {}
): Promise< AiSessionSummary > {
	const { site } = options;
	if ( ! site ) {
		return hydrateAiSessionSummary( await createAiSession( rootDirectory ) );
	}

	const created = await createAiSession( rootDirectory, {
		site: { id: site.id, name: site.name, path: site.path },
	} );
	const placement = await setAiSessionSitePlacement( created.id, {
		siteId: site.id,
		siteName: site.name,
		sitePath: site.path,
	} );
	return hydrateAiSessionSummary( created, undefined, placement );
}

/**
 * A session left on 'live' after its remote site was disconnected falls back to
 * its local owner site. The UI already derives that at render time; this records
 * it in the session so the CLI's next turn (prompt and tools) agrees.
 */
export async function reconcileSessionEnvironment(
	root: string,
	sessionId: string
): Promise< void > {
	const { summary } = await loadHydratedAiSession( root, sessionId );
	if ( summary.activeEnvironment !== 'live' ) {
		return;
	}
	const ownerSite = findAiSessionOwnerSite( await readSites(), summary );
	if ( ! ownerSite ) {
		return;
	}
	const connectedIds = new Set(
		( await getConnectedWpcomSitesForLocalSite( ownerSite.id ) ).map( ( site ) => site.id )
	);
	if (
		deriveEffectiveEnvironment( summary, ( blogId ) => connectedIds.has( blogId ) ) === 'live'
	) {
		return;
	}
	await appendStudioEntry( root, sessionId, 'studio.site_selected', {
		siteName: ownerSite.name,
		sitePath: ownerSite.path,
		siteId: ownerSite.id,
	} );
}

/**
 * Points the chat's next turn at its owner site, locally or on its connected
 * WordPress.com site. Recorded as the same `studio.site_selected` entry the
 * agent writes, so the CLI resumes on it.
 */
export async function setSessionEnvironment(
	root: string,
	sessionId: string,
	environment: 'local' | 'live'
): Promise< void > {
	const { summary } = await loadHydratedAiSession( root, sessionId );
	const ownerSite = findAiSessionOwnerSite( await readSites(), summary );
	if ( ! ownerSite ) {
		throw new Error( 'This chat is not attached to a site.' );
	}
	if ( environment === 'local' ) {
		await appendStudioEntry( root, sessionId, 'studio.site_selected', {
			siteName: ownerSite.name,
			sitePath: ownerSite.path,
			siteId: ownerSite.id,
		} );
		return;
	}
	const liveSite = pickLiveSite( await getConnectedWpcomSitesForLocalSite( ownerSite.id ) );
	if ( ! liveSite ) {
		throw new Error( 'This site is not connected to a WordPress.com site.' );
	}
	await appendStudioEntry( root, sessionId, 'studio.site_selected', {
		siteName: ownerSite.name,
		sitePath: ownerSite.path,
		siteId: ownerSite.id,
		remote: true,
		url: liveSite.url,
		wpcomSiteId: liveSite.id,
	} );
}
