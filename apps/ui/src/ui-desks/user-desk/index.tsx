import { createRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSaveUserDeskConfig, useUserDeskConfig } from '@/data/queries/use-desk-config';
import { DeskChats } from '../chats';
import { DeskChrome } from '../chrome';
import { desksRootRoute } from '../router/root';
import { defaultUserDesk } from './default-user-desk';
import styles from './style.module.css';
import { UserDeskCanvas } from './user-desk-canvas';
import type { DeskConfig } from '@/ui-desks/desk/types';

function UserDeskRoute() {
	return (
		<>
			<DeskChrome />
			<DeskChats />
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
	component: UserDeskRoute,
} );
