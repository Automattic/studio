import { useEffect, useMemo } from 'react';
import { useDeskConfig, useSaveDeskConfig } from '@/data/queries/use-desk-config';
import { createDefaultSiteDeskConfig, defaultUserDesk } from '../default-desk';
import type { DeskConfig } from '../types';

interface DeskPersistenceOptions {
	enabled?: boolean;
}

export function useDeskPersistence( siteId?: string, options: DeskPersistenceOptions = {} ) {
	const enabled = options.enabled ?? true;
	const { data: savedDesk, isLoading } = useDeskConfig( siteId, enabled );
	const { mutate: saveDeskConfig } = useSaveDeskConfig( siteId );
	const defaultDesk = useMemo( () => createDefaultDeskConfig( siteId ), [ siteId ] );
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;

	useEffect( () => {
		if ( enabled && ! isLoading && ! savedDesk ) {
			saveDeskConfig( defaultDesk );
		}
	}, [ defaultDesk, enabled, isLoading, savedDesk, saveDeskConfig ] );

	return {
		desk,
		isLoading,
		saveDeskConfig,
	};
}

function createDefaultDeskConfig( siteId?: string ): DeskConfig {
	if ( siteId ) {
		return createDefaultSiteDeskConfig();
	}

	return defaultUserDesk;
}
