import { readConfig, readConfigSync, updateConfig } from './config/store';

/**
 * This install's anonymous ids, shared by Studio and the Studio CLI, and the analytics opt-out.
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
