import { useEffect, useMemo } from 'react';
import { useDeskConfig, useSaveDeskConfig } from '@/data/queries/use-desk-config';
import { defaultUserDesk } from '../default-desk';
import { DESK_CONFIG_VERSION, type DeskConfig } from '../types';

export function useDeskPersistence( siteId?: string ) {
	const { data: savedDesk, isLoading } = useDeskConfig( siteId );
	const { mutate: saveDeskConfig } = useSaveDeskConfig( siteId );
	const defaultDesk = useMemo( () => createDefaultDeskConfig( siteId ), [ siteId ] );
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;

	useEffect( () => {
		if ( ! isLoading && ! savedDesk ) {
			saveDeskConfig( defaultDesk );
		}
	}, [ defaultDesk, isLoading, savedDesk, saveDeskConfig ] );

	return {
		desk,
		isLoading,
		saveDeskConfig,
	};
}

function createDefaultDeskConfig( siteId?: string ): DeskConfig {
	if ( siteId ) {
		return {
			version: DESK_CONFIG_VERSION,
			updatedAt: new Date().toISOString(),
			widgets: [],
		};
	}

	return defaultUserDesk;
}
