import { getDefaultSidebarChatSort } from '@studio/common/lib/user-settings/preferences';
import { __ } from '@wordpress/i18n';
import { errorMessage, toast } from '@/data/app-messages';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import type { UserPreferences } from '@/data/core';

type SidebarPreferences = Partial<
	Pick<
		UserPreferences,
		| 'sidebarPins'
		| 'sidebarChatOrder'
		| 'sidebarPinnedSort'
		| 'sidebarSiteSort'
		| 'sidebarChatSort'
		| 'showRecentChats'
		| 'autoCollapseSites'
	>
>;

const NO_PINS: string[] = [];
const NO_ORDER: Record< string, string[] > = {};

// Chats the user dragged keep their place; newer ones go on top.
export function orderChats< T extends { id: string } >( chats: T[], order: string[] | undefined ) {
	if ( ! order ) {
		return chats;
	}
	const positions = new Map( order.map( ( id, index ) => [ id, index ] ) );
	return [ ...chats ].sort(
		( a, b ) => ( positions.get( a.id ) ?? -1 ) - ( positions.get( b.id ) ?? -1 )
	);
}

export const sitePinKey = ( siteId: string ) => `site:${ siteId }`;
export const chatPinKey = ( sessionId: string ) => `chat:${ sessionId }`;

// The sidebar's preferences, kept in app.json so both Studio apps share them.
export function useSidebarPreferences() {
	const { mutate } = useSaveUserPreferences();
	const preferences = useUserPreferences().data;

	const save = ( patch: SidebarPreferences, failure: string = __( 'Couldn’t save the sidebar' ) ) =>
		mutate( patch, {
			onError: ( error ) => toast.error( failure, { description: errorMessage( error ) } ),
		} );

	return {
		pins: preferences?.sidebarPins ?? NO_PINS,
		chatOrder: preferences?.sidebarChatOrder ?? NO_ORDER,
		pinnedSort: preferences?.sidebarPinnedSort ?? 'type',
		siteSort: preferences?.sidebarSiteSort ?? 'manual',
		chatSort:
			preferences?.sidebarChatSort ??
			getDefaultSidebarChatSort( preferences?.sidebarChatOrder ?? NO_ORDER ),
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
