import { createHmac, randomBytes } from 'node:crypto';
import { getCurrentUserId } from './auth-token';
import { readConfig, readConfigSync, updateConfig } from './config/store';
import type { TracksIdentity, TracksProps } from './record-tracks-event';

/**
 * This install's anonymous ids, shared by Studio and the Studio CLI, the identity Tracks events
 * are attributed to, and the analytics opt-out.
 * See `docs/design-docs/analytics-tracks.md`.
 */

// The Tracks install id, minted on first use.
export async function getOrCreateAnalyticsInstallId(): Promise< string > {
	const { analyticsId } = ( await readConfig() ).install;
	if ( analyticsId ) {
		return analyticsId;
	}
	return updateConfig( ( { install } ) => ( install.analyticsId ??= crypto.randomUUID() ) );
}

/**
 * Random ids that join an event to others: on a logged-in event they would join the account to the
 * install's anonymous events. A logged-in event carries its own value for each instead, keyed by a
 * secret that never leaves this computer, so logged-in events still join each other.
 */
const JOIN_ID_PROPS = [
	'site_id',
	'preview_id',
	'ai_session_id',
	'journey_id',
	'auth_attempt_id',
	'turn_id',
	'draw_id',
];
// A timestamp shared by the events of one journey, which would join them just the same.
const JOIN_TIMING_PROPS = [ 'journey_started_at' ];

async function getOrCreateAccountTracksKey(): Promise< string > {
	return (
		( await readConfig() ).install.accountTracksKey ??
		updateConfig(
			( { install } ) => ( install.accountTracksKey ??= randomBytes( 32 ).toString( 'hex' ) )
		)
	);
}

function accountScopedId( key: string, prop: string, value: string ): string {
	const hex = createHmac( 'sha256', key ).update( `${ prop }:${ value }` ).digest( 'hex' );
	return [ 0, 8, 12, 16, 20 ]
		.map( ( start, index, starts ) => hex.slice( start, starts[ index + 1 ] ?? 32 ) )
		.join( '-' );
}

async function unlinkFromInstall( props: TracksProps ): Promise< TracksProps > {
	const joinIds = JOIN_ID_PROPS.filter( ( prop ) => props[ prop ] !== undefined );
	const unlinked = { ...props };
	for ( const prop of JOIN_TIMING_PROPS ) {
		delete unlinked[ prop ];
	}
	if ( ! joinIds.length ) {
		return unlinked;
	}
	const key = await getOrCreateAccountTracksKey();
	for ( const prop of joinIds ) {
		unlinked[ prop ] = accountScopedId( key, prop, String( props[ prop ] ) );
	}
	return unlinked;
}

/**
 * Who an event is attributed to. Logged in to WordPress.com, it is the account, but only where
 * `linkAccount` (a Studio app, not the standalone CLI) and once the person has seen that usage
 * statistics are linked to it (`preferences.usageNoticeSeen`). Linking goes forward only: a
 * logged-in event carries neither the install id nor any id an anonymous event carries. Otherwise
 * the event is anonymous, attributed to the install.
 */
export async function identifyTracksEvent(
	props: TracksProps,
	{ linkAccount }: { linkAccount: boolean }
): Promise< { identity: TracksIdentity; props: TracksProps } > {
	if ( linkAccount && ( await readConfig() ).preferences.usageNoticeSeen === true ) {
		const userId = await getCurrentUserId();
		if ( userId ) {
			return {
				identity: { type: 'wpcom:user_id', id: String( userId ) },
				props: await unlinkFromInstall( props ),
			};
		}
	}
	return { identity: { type: 'anon', id: await getOrCreateAnalyticsInstallId() }, props };
}

// The Desktop app mints it; the CLI only reads it, so its reports count the same install.
export async function getOrCreateSentryUserId(): Promise< string > {
	return (
		( await readConfig() ).install.sentryUserId ??
		updateConfig( ( { install } ) => ( install.sentryUserId ??= crypto.randomUUID() ) )
	);
}

// Synchronous so Sentry has the user from its first event.
export function readSentryUserId(): string | undefined {
	return readConfigSync().install.sentryUserId;
}

// Analytics are on unless the user opted out. Doesn't affect MC Stats or Sentry.
export async function isAnalyticsOptedOut(): Promise< boolean > {
	return ( await readConfig() ).preferences.analyticsOptOut === true;
}
