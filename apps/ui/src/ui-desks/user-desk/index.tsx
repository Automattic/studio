import { useEffect, useMemo } from 'react';
import { useSaveUserDeskConfig, useUserDeskConfig } from '@/data/queries/use-desk-config';
import { createDefaultUserDesk } from './default-user-desk';
import styles from './style.module.css';
import { UserDeskCanvas } from './user-desk-canvas';
import type { DeskConfig } from '@/ui-desks/desk/types';

export function UserDesk() {
	const { data: savedDesk, isLoading } = useUserDeskConfig();
	const { mutate: saveUserDeskConfig } = useSaveUserDeskConfig();
	const defaultDesk = useMemo( () => createDefaultUserDesk(), [] );
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;

	useEffect( () => {
		if ( ! isLoading && ! savedDesk ) {
			saveUserDeskConfig( defaultDesk );
		}
	}, [ defaultDesk, isLoading, savedDesk, saveUserDeskConfig ] );

	if ( isLoading ) {
		return <main className={ styles.loading } />;
	}

	return <UserDeskCanvas desk={ desk } onChange={ saveUserDeskConfig } />;
}
