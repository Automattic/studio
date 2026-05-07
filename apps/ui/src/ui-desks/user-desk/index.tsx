import { useEffect, useMemo } from 'react';
import { useSaveUserDeskConfig, useUserDeskConfig } from '@/data/queries/use-desk-config';
import { createDefaultUserDesk } from './default-user-desk';
import { normalizeDeskConfig } from './normalize-desk-config';
import styles from './style.module.css';
import { UserDeskCanvas } from './user-desk-canvas';

export function UserDesk() {
	const { data: savedDesk, isLoading } = useUserDeskConfig();
	const { mutate: saveUserDeskConfig } = useSaveUserDeskConfig();
	const defaultDesk = useMemo( () => createDefaultUserDesk(), [] );
	const normalizedSavedDesk = useMemo( () => normalizeDeskConfig( savedDesk ), [ savedDesk ] );
	const desk = normalizedSavedDesk ?? defaultDesk;

	useEffect( () => {
		if ( isLoading ) {
			return;
		}
		if ( ! savedDesk || normalizedSavedDesk !== savedDesk ) {
			saveUserDeskConfig( desk );
		}
	}, [ desk, isLoading, normalizedSavedDesk, savedDesk, saveUserDeskConfig ] );

	if ( isLoading ) {
		return <main className={ styles.loading } />;
	}

	return <UserDeskCanvas desk={ desk } onChange={ saveUserDeskConfig } />;
}
