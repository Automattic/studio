import { isRTL } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useSidebarOpen, useSidebarHover } from '@/data/use-sidebar-collapsed';
import { useFullscreen } from '@/data/host/use-fullscreen';

/**
 * Which inline edge should leave a gap for the macOS window controls
 * ("traffic lights").
 *
 * The native buttons are laid out from the physical left. Headers reserve
 * that edge while the sidebar is showing, including a temporary hover reveal.
 */
export function useTrafficLightSpace(): { start: boolean; end: boolean } {
	const connector = useConnector();
	const isFullscreen = useFullscreen();
	const open = useSidebarOpen();
	const { peek } = useSidebarHover();
	const visible =
		connector.reservesTrafficLightSpace &&
		! isFullscreen &&
		( ! connector.setTrafficLightVisibility || open || peek );
	return {
		start: visible && ! isRTL(),
		end: visible && isRTL(),
	};
}
