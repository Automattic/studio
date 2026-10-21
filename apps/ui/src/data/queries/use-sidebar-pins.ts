import { useQueryClient } from '@tanstack/react-query';
import {
	USER_PREFERENCES_QUERY_KEY,
	useSaveUserPreferences,
	useUserPreferences,
} from '@/data/queries/use-user-preferences';
import type { UserPreferences } from '@/data/core';

const NO_PINS: string[] = [];

export const sitePinKey = ( siteId: string ) => `site:${ siteId }`;
export const chatPinKey = ( sessionId: string ) => `chat:${ sessionId }`;

// The sidebar's Pinned group, kept in app.json so both Studio apps share it.
export function useSidebarPins() {
	const queryClient = useQueryClient();
	const { mutate } = useSaveUserPreferences();
	const pins = useUserPreferences().data?.sidebarPins ?? NO_PINS;

	// Applied to the cache first, so a drag or a pin lands without waiting for the write.
	const setPins = ( sidebarPins: string[] ) => {
		queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( prev ) =>
			prev ? { ...prev, sidebarPins } : prev
		);
		mutate( { sidebarPins } );
	};

	return {
		pins,
		setPins,
		isPinned: ( key: string ) => pins.includes( key ),
		// New pins go to the top of the group.
		togglePin: ( key: string ) =>
			setPins( pins.includes( key ) ? pins.filter( ( pin ) => pin !== key ) : [ key, ...pins ] ),
	};
}
