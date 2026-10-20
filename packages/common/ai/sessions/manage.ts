import { deriveEffectiveEnvironment } from '@studio/common/ai/sessions/effective-site';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	deleteAiSessionPlacement,
	hydrateAiSessionSummaryWithPlacement,
	readAiSessionPlacement,
	readAiSessionPlacements,
	setAiSessionSitePlacement,
	type AiSessionSitePlacement,
} from '@studio/common/ai/sessions/placement';
import {
	appendStudioEntry,
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '@studio/common/ai/sessions/store';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import {
	deleteSharedSession,
	readSharedSession,
	readSharedSessions,
} from '@studio/common/lib/shared-config';
import { readSites } from '@studio/common/sites/site-path';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';

/**
 * Session listing + creation, hydrated with the metadata that lives outside the
 * session JSONL: the archived flag (shared config) and site placement
 * (app.json).
 */

// A local site a session can be bound to.
export interface SessionSite {
	id: string;
	name: string;
	path: string;
}

export function hydrateAiSessionSummary(
	summary: AiSessionSummary,
	metadata?: Pick< AiSessionSummary, 'archived' >,
	placement?: AiSessionSitePlacement
): AiSessionSummary {
	return hydrateAiSessionSummaryWithPlacement(
		{ ...summary, archived: metadata?.archived },
		placement
	);
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
