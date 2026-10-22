import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { errorMessage, toast } from '@/data/app-messages';
import {
	USER_PREFERENCES_QUERY_KEY,
	useSaveUserPreferences,
	useUserPreferences,
} from '@/data/queries/use-user-preferences';
import type { UserPreferences } from '@/data/core';

type SidebarPreferences = Partial<
	Pick<
		UserPreferences,
		'sidebarPins' | 'sidebarChatOrder' | 'showRecentChats' | 'autoCollapseSites'
	>
>;

const NO_PINS: string[] = [];
const NO_ORDER: Record< string, string[] > = {};

export const sitePinKey = ( siteId: string ) => `site:${ siteId }`;
export const chatPinKey = ( sessionId: string ) => `chat:${ sessionId }`;

// The sidebar's preferences, kept in app.json so both Studio apps share them.
export function useSidebarPreferences() {
	const queryClient = useQueryClient();
	const { mutate } = useSaveUserPreferences();
	const preferences = useUserPreferences().data;

	// Applied to the cache first, so a drag or a pin lands without waiting for
	// the write; a failed write puts the previous values back.
	const save = (
		patch: SidebarPreferences,
		failure: string = __( 'Couldn’t save the sidebar' )
	) => {
		const previous = queryClient.getQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY );
		const apply = ( values: SidebarPreferences ) =>
			queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( prev ) =>
				prev ? { ...prev, ...values } : prev
			);
		apply( patch );
		mutate( patch, {
			onError: ( error ) => {
				if ( previous ) {
					apply(
						Object.fromEntries(
							Object.keys( patch ).map( ( key ) => [
								key,
								previous[ key as keyof SidebarPreferences ],
							] )
						)
					);
				}
				toast.error( failure, { description: errorMessage( error ) } );
			},
		} );
	};

	return {
		pins: preferences?.sidebarPins ?? NO_PINS,
		chatOrder: preferences?.sidebarChatOrder ?? NO_ORDER,
		showRecentChats: preferences?.showRecentChats !== false,
		autoCollapseSites: preferences?.autoCollapseSites !== false,
		save,
	};
}

export function useSidebarPins() {
	const { pins, save } = useSidebarPreferences();
	const setPins = ( sidebarPins: string[] ) => save( { sidebarPins } );

	return {
		pins,
		setPins,
		isPinned: ( key: string ) => pins.includes( key ),
		// New pins go to the bottom of the group.
		togglePin: ( key: string ) =>
			setPins( pins.includes( key ) ? pins.filter( ( pin ) => pin !== key ) : [ ...pins, key ] ),
	};
}
