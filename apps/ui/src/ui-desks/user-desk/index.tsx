import { createRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSaveUserDeskConfig, useUserDeskConfig } from '@/data/queries/use-desk-config';
import { UserDeskChats } from '../chats';
import { DeskChrome } from '../chrome';
import { useDesksNavigate } from '../router/navigation';
import { desksRootRoute } from '../router/root';
import { defaultUserDesk } from './default-user-desk';
import styles from './style.module.css';
import { UserDeskCanvas } from './user-desk-canvas';
import type { DeskConfig } from '@/ui-desks/desk/types';

interface UserDeskSearch {
	chats?: boolean;
	newChat?: number;
}

function parseChatsSearch( value: unknown ) {
	return value === true || value === 'true' || value === '1' || value === 'open';
}

function parseNewChatSearch( value: unknown ) {
	const parsed = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( parsed ) && parsed > 0 ? parsed : undefined;
}

function UserDeskRoute() {
	const { chats, newChat } = userDeskRoute.useSearch() as UserDeskSearch;
	const navigate = useDesksNavigate();
	const chatsOpen = chats === true;

	const setChatsOpen = ( open: boolean ) => {
		void navigate( {
			to: '/',
			search: ( previous ) => ( {
				...previous,
				chats: open ? true : undefined,
			} ),
		} );
	};

	return (
		<>
			<DeskChrome chatsOpen={ chatsOpen } onToggleChats={ () => setChatsOpen( ! chatsOpen ) } />
			<UserDeskChats
				open={ chatsOpen }
				onOpenChange={ setChatsOpen }
				createChatRequestId={ newChat ?? 0 }
			/>
			<UserDesk />
		</>
	);
}

export function UserDesk() {
	const { data: savedDesk, isLoading } = useUserDeskConfig();
	const { mutate: saveUserDeskConfig } = useSaveUserDeskConfig();
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultUserDesk;

	useEffect( () => {
		if ( ! isLoading && ! savedDesk ) {
			saveUserDeskConfig( defaultUserDesk );
		}
	}, [ isLoading, savedDesk, saveUserDeskConfig ] );

	if ( isLoading ) {
		return <main className={ styles.loading } />;
	}

	return <UserDeskCanvas desk={ desk } onChange={ saveUserDeskConfig } />;
}

export const userDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/',
	validateSearch: ( search: Record< string, unknown > ): UserDeskSearch => ( {
		chats: parseChatsSearch( search.chats ) || undefined,
		newChat: parseNewChatSearch( search.newChat ),
	} ),
	component: UserDeskRoute,
} );
