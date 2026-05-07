import { useEffect } from 'react';
import { useSaveUserDeskConfig, useUserDeskConfig } from '@/data/queries/use-desk-config';
import { defaultUserDesk } from './default-user-desk';
import styles from './style.module.css';
import { UserDeskCanvas } from './user-desk-canvas';
import type { DeskConfig } from '@/ui-desks/desk/types';

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
