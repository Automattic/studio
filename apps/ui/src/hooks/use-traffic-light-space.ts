import { useConnector } from '@/data/core';
import { useFullscreen } from '@/hooks/use-fullscreen';

/**
 * Whether the UI should reserve the top-left gap for macOS window controls
 * ("traffic lights").
 *
 * True only when the host overlays them (the macOS desktop app — never the
 * browser) AND the window isn't fullscreen (macOS hides the traffic lights in
 * fullscreen). On Windows/Linux and in `studio ui` / hosted, this is always
 * false, so the sidebar header and the collapsed-sidebar toggle sit flush
 * against the left edge instead of leaving an empty gap.
 */
export function useTrafficLightSpace(): boolean {
	const connector = useConnector();
	const isFullscreen = useFullscreen();
	return connector.reservesTrafficLightSpace && ! isFullscreen;
}
