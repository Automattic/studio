import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import type {
	TracksSyncFailureReason,
	TracksSyncType,
} from '@studio/common/lib/record-tracks-event';
import type { SyncFailureHint } from '@studio/common/lib/sync/classify-sync-failure';
import type { SyncOption } from '@studio/common/types/sync';
import type { SitesProviderId } from '@studio/providers';

// Kept free of Node imports so the renderers can share these helpers with the
// main process and the `studio ui` server.

// A type alias rather than an interface: interfaces have no implicit index
// signature, so they aren't assignable to the wrappers' `TracksProps`.
export type SyncSelectionProps = {
	selection: 'full' | 'categories' | 'folders' | 'unknown';
	includes_database: boolean;
};

type SyncSelection =
	| {
			skipDatabase?: boolean;
			skipFiles?: boolean;
			databaseOnly?: boolean;
			fileOnlyPaths?: string[];
	  }
	| {
			optionsToSync: SyncOption[];
			specificSelectionPaths?: string[];
	  };

export function classifySyncSelection( input: SyncSelection ): SyncSelectionProps {
	if ( 'optionsToSync' in input ) {
		const { optionsToSync, specificSelectionPaths } = input;
		const includes_database = optionsToSync.includes( 'all' ) || optionsToSync.includes( 'sqls' );
		const folders = specificSelectionPaths?.some( isFolderPath );
		return {
			selection: folders
				? 'folders'
				: optionsToSync.includes( 'paths' ) && ! specificSelectionPaths?.length
				? 'unknown'
				: optionsToSync.includes( 'all' ) ||
				  ( includes_database &&
						optionsToSync.includes( 'contents' ) &&
						! specificSelectionPaths?.length )
				? 'full'
				: 'categories',
			includes_database,
		};
	}

	const includes_database = ! input.skipDatabase;
	const paths = input.skipFiles || input.databaseOnly ? [] : input.fileOnlyPaths ?? [];
	return {
		selection: paths.some( isFolderPath )
			? 'folders'
			: includes_database && ! input.skipFiles && ! input.databaseOnly && ! paths.length
			? 'full'
			: 'categories',
		includes_database,
	};
}

function isFolderPath( value: string ): boolean {
	const segments = value
		.replace( /^(?::wp-content:|wp-content)\//, '' )
		.split( '/' )
		.filter( Boolean );
	return segments.length > 1;
}

export type SyncEventProps = Partial< SyncSelectionProps > & {
	success: boolean;
	sync_type: TracksSyncType;
	time_ms: number;
	failure_reason?: TracksSyncFailureReason;
};

/**
 * The shared prop shape for `studio_sync_push` / `studio_sync_pull`, so every
 * command that records them emits identical props instead of drifting apart.
 *
 * `failure_reason` is present only on failures. Cancelled syncs must not reach
 * here at all — they emit no event.
 */
export function buildSyncEventProps( {
	startedAt,
	provider,
	site,
	error,
	hint,
	selection,
}: {
	startedAt: number;
	provider?: SitesProviderId;
	site: object | undefined;
	error?: unknown;
	hint?: SyncFailureHint;
	selection?: SyncSelectionProps;
} ): SyncEventProps {
	const success = error === undefined;
	return {
		success,
		...selection,
		sync_type: getSyncType( site, provider ),
		time_ms: Date.now() - startedAt,
		...( success ? {} : { failure_reason: classifySyncFailure( error, hint ) } ),
	};
}
