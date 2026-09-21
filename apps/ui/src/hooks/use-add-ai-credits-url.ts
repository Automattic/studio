import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import { useAppGlobals } from '@/data/queries/use-app-globals';

/**
 * Builds checkout URLs for an AI credits top-up. This app runs both inside the
 * desktop app and as a plain browser tab, and only the former can be returned
 * to by the `wp-studio://` deeplink — so the return is asked for at runtime,
 * and while the host is still unknown we ask for nothing rather than risk
 * sending a browser to a scheme it can't open.
 */
export function useAddAiCreditsUrlBuilder(): ( credits?: number ) => string {
	const { data: appGlobals } = useAppGlobals();
	const returnsToDesktop = !! appGlobals && appGlobals.platform !== 'browser';
	return ( credits?: number ) => getAddAiCreditsUrl( { returnsToDesktop, credits } );
}

/** Checkout URL for the default single top-up. */
export function useAddAiCreditsUrl(): string {
	return useAddAiCreditsUrlBuilder()();
}
