import { isRTL } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useFullscreen } from '@/hooks/use-fullscreen';

/**
 * Which inline edge should leave a gap for the macOS window controls
 * ("traffic lights").
 *
 * The lights always sit at the window's physical top-left, so the gap belongs
 * at inline-start in LTR and inline-end in RTL. Both are false when the host
 * doesn't overlay them (browser, Windows/Linux) or the window is fullscreen
 * (macOS hides them there).
 */
export function useTrafficLightSpace(): { start: boolean; end: boolean } {
	const connector = useConnector();
	const isFullscreen = useFullscreen();
	const visible = connector.reservesTrafficLightSpace && ! isFullscreen;
	return {
		start: visible && ! isRTL(),
		end: visible && isRTL(),
	};
}
