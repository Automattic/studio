import type { TracksSyncFailureReason } from '@studio/common/lib/record-tracks-event';

// Kept free of Node imports so the renderers can share these helpers with the
// main process and the `studio ui` server. Mirrors `classifyFailure` in
// `apps/cli/lib/utils.ts`, but without the `LoggerError` dependency — that type
// can't cross into a renderer, so callers pass a `code` hint instead.

// The step a sync was in when it broke. Used as the fallback bucket when nothing
// more specific identifies the failure, so a caller that knows only "the upload
// threw" still records something better than `unknown`. `storage_write` and
// `site_fetch` are the connect flow's two steps.
export type SyncFailurePhase =
	| 'local_export'
	| 'upload'
	| 'remote_backup'
	| 'remote_import'
	| 'local_import'
	| 'storage_write'
	| 'site_fetch';

export interface SyncFailureHint {
	phase?: SyncFailurePhase;
	// HTTP status of the failing request, when the call site has one.
	status?: number;
	// A bucket the call site already knows for certain (e.g. the size check that
	// rejected before any request was made).
	code?: string;
}

const FAILURE_REASONS: readonly TracksSyncFailureReason[] = [
	'size_limit',
	'sql_import',
	'timeout',
	'remote_backup',
	'remote_import',
	'upload',
	'network',
	'payload_too_large',
	'auth',
	'not_found',
	'local_import',
	'local_export',
	'disk_full',
	'storage_write',
	'site_fetch',
	'unknown',
];

function isFailureReason( value: string ): value is TracksSyncFailureReason {
	return ( FAILURE_REASONS as readonly string[] ).includes( value );
}

function fromStatus( status: number ): TracksSyncFailureReason | undefined {
	if ( status === 413 ) {
		return 'payload_too_large';
	}
	if ( status === 401 || status === 403 ) {
		return 'auth';
	}
	if ( status === 404 ) {
		return 'not_found';
	}
	return undefined;
}

// System/library errors carry no code and are never translated, so they are matched by substring.
// Only untranslated substrings belong here — `__()` display text is locale-dependent and embeds
// site names and filesystem paths, so it would both break in other locales and risk leaking PII.
const UNTRANSLATED_BUCKETS: Array< [ string[], TracksSyncFailureReason ] > = [
	[ [ 'enospc', 'no space left' ], 'disk_full' ],
	[ [ 'econnreset', 'enotfound', 'econnrefused', 'network error' ], 'network' ],
	[ [ 'etimedout', 'timed out' ], 'timeout' ],
];

/**
 * Coarse, low-cardinality classification of a sync failure for the
 * `failure_reason` Tracks prop.
 *
 * Precedence, highest first: an untranslated substring match (an environment
 * failure outranks the step it interrupted), then an explicit `code` the call
 * site is certain of, the HTTP status, and finally the phase the sync was in.
 *
 * The raw error is never returned — it can embed site names, URLs, and
 * filesystem paths, and its cardinality would make the prop unqueryable.
 */
export function classifySyncFailure(
	error: unknown,
	hint?: SyncFailureHint
): TracksSyncFailureReason {
	// Substrings first, matching `classifyFailure` in `apps/cli/lib/utils.ts`: an
	// environment failure like a full disk is more actionable than the step it
	// happened to interrupt, so it wins over that step's own bucket.
	const message = error instanceof Error ? error.message : String( error ?? '' );
	const normalized = message.toLowerCase();
	for ( const [ substrings, bucket ] of UNTRANSLATED_BUCKETS ) {
		if ( substrings.some( ( substring ) => normalized.includes( substring ) ) ) {
			return bucket;
		}
	}

	if ( hint?.code && isFailureReason( hint.code ) ) {
		return hint.code;
	}

	if ( hint?.status !== undefined ) {
		const fromHttpStatus = fromStatus( hint.status );
		if ( fromHttpStatus ) {
			return fromHttpStatus;
		}
	}

	return hint?.phase ?? 'unknown';
}
