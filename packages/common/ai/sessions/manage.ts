import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import {
	deleteAiSessionPlacement,
	hydrateAiSessionSummaryWithPlacement,
	readAiSessionPlacement,
	readAiSessionPlacements,
	setAiSessionSitePlacement,
	type AiSessionSitePlacement,
} from '@studio/common/ai/sessions/placement';
import {
	createAiSession,
	deleteAiSession,
	listAiSessions,
	loadAiSession,
} from '@studio/common/ai/sessions/store';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import {
	deleteSharedSession,
	readSharedSession,
	readSharedSessions,
} from '@studio/common/lib/shared-config';
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

function newestFirst( a: AiSessionSummary, b: AiSessionSummary ): number {
	return Date.parse( b.updatedAt ) - Date.parse( a.updatedAt );
}

/**
 * Create a session, or reuse the newest existing empty "draft" one (never
 * prompted, not archived) so repeatedly opening "new chat" doesn't pile up
 * orphan sessions. When a `site` is given, the session is bound to it (recorded
 * in the session file) and its placement is persisted so the UI shows it under
 * that site; the reuse match is scoped to that same site.
 *
 * `created` reports whether a session was actually made, so hosts can count real
 * creations without duplicating the reuse rules above.
 */
export async function createOrReuseAiSession(
	rootDirectory: string,
	options: { site?: SessionSite } = {}
): Promise< AiSessionSummary & { created: boolean } > {
	const { site } = options;
	const existing = await listHydratedAiSessions( rootDirectory );

	if ( ! site ) {
		const reusable = existing
			.filter(
				( session ) =>
					! session.ownerSiteId &&
					! session.ownerSitePath &&
					! session.firstPrompt &&
					! session.archived
			)
			.sort( newestFirst )[ 0 ];
		if ( reusable ) {
			return { ...reusable, created: false };
		}
		return {
			...hydrateAiSessionSummary( await createAiSession( rootDirectory ) ),
			created: true,
		};
	}

	const reusable = existing
		.filter(
			( session ) =>
				! session.firstPrompt && ! session.archived && aiSessionBelongsToSite( session, site )
		)
		.sort( newestFirst )[ 0 ];
	if ( reusable ) {
		return { ...reusable, created: false };
	}

	const created = await createAiSession( rootDirectory, {
		site: { id: site.id, name: site.name, path: site.path },
	} );
	const placement = await setAiSessionSitePlacement( created.id, {
		siteId: site.id,
		siteName: site.name,
		sitePath: site.path,
	} );
	return { ...hydrateAiSessionSummary( created, undefined, placement ), created: true };
}
