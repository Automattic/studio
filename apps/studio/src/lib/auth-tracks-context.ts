import type {
	TracksAuthAccountType,
	TracksAuthSource,
} from '@studio/common/lib/record-tracks-event';

// `source` and `account_type` for `studio_wpcom_auth` are known only when auth *starts* (the affordance
// the user clicked, and whether we opened the login or the signup URL), but the outcome arrives much
// later, in a deep link that carries nothing but a token. This module bridges the two: both ends run in
// the Main process, so a module-level value is enough — no persistence, and it dies with the process.
//
// Deliberately lossy. When the link can't be made (see `takePendingAuthContext`) the event still fires,
// reporting `source: 'unknown'` rather than guessing.

// Long enough for a slow login (find the browser, sign in, maybe 2FA), short enough that a context
// abandoned hours ago never attaches itself to an unrelated deep link.
const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;

interface PendingAuthContext {
	source: TracksAuthSource;
	accountType: TracksAuthAccountType;
	startedAt: number;
}

let pending: PendingAuthContext | undefined;

// Records where an auth attempt started. Last write wins: if the user opens several login tabs, the one
// they finish is almost always the most recent, so the newest context is the best guess for the deep
// link that eventually arrives.
export function setPendingAuthContext(
	source: TracksAuthSource,
	accountType: TracksAuthAccountType
): void {
	pending = { source, accountType, startedAt: Date.now() };
}

// Reads and clears the context. Returns `undefined` when there is nothing to attribute — no initiation
// seen (the app restarted mid-flow, or the deep link cold-started it), the context expired, or it was
// already consumed by an earlier deep link. Clearing is what keeps a stale context from being reused.
export function takePendingAuthContext(): PendingAuthContext | undefined {
	const context = pending;
	pending = undefined;

	if ( ! context || Date.now() - context.startedAt > PENDING_AUTH_TTL_MS ) {
		return undefined;
	}

	return context;
}

// Test-only: drop any context left over from a previous case.
export function __resetPendingAuthContext(): void {
	pending = undefined;
}
