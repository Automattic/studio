import { isRTL } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useFullscreen } from '@/hooks/use-fullscreen';

/**
 * Whether the macOS window controls ("traffic lights") overlay the UI at all:
 * the host overlays them (the macOS desktop app — never the browser) AND the
 * window isn't fullscreen (macOS hides them in fullscreen). They are anchored
 * to the window's physical LEFT edge (fixed `trafficLightPosition`) regardless
 * of text direction — use this directly for elements that end up at the
 * physical left in RTL (e.g. the settings close button).
 */
export function useTrafficLightsVisible(): boolean {
	const connector = useConnector();
	const isFullscreen = useFullscreen();
	return connector.reservesTrafficLightSpace && ! isFullscreen;
}

/**
 * Whether the UI should reserve the inline-start gap for the traffic lights.
 *
 * True only when they're visible AND the UI is LTR: an RTL locale flips the
 * sidebar (and other inline-start consumers) to the right, away from the
 * lights, so no gap is needed. On Windows/Linux and in `studio ui` / hosted,
 * this is always false, so the sidebar header and the collapsed-sidebar
 * toggle sit flush against the edge instead of leaving an empty gap.
 */
export function useTrafficLightSpace(): boolean {
	return useTrafficLightsVisible() && ! isRTL();
}
