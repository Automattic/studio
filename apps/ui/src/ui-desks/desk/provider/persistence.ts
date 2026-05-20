import { useEffect, useMemo } from 'react';
import { useDeskConfig, useSaveDeskConfig } from '@/data/queries/use-desk-config';
import { createDefaultSiteDeskConfig, defaultUserDesk } from '../default-desk';
import type { DeskConfig } from '../types';

interface DeskPersistenceOptions {
	enabled?: boolean;
	defaultSiteUrl?: string;
	isDefaultSiteUrlLoading?: boolean;
}

export function useDeskPersistence( siteId?: string, options: DeskPersistenceOptions = {} ) {
	const enabled = options.enabled ?? true;
	const { data: savedDesk, isLoading } = useDeskConfig( siteId, enabled );
	const { mutate: saveDeskConfig } = useSaveDeskConfig( siteId );
	const defaultDesk = useMemo(
		() => createDefaultDeskConfig( siteId, options.defaultSiteUrl ),
		[ options.defaultSiteUrl, siteId ]
	);
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;
	const canSaveDefaultDesk = ! siteId || Boolean( options.defaultSiteUrl );
	const isWaitingForDefaultSiteUrl = Boolean(
		siteId && ! savedDesk && ! canSaveDefaultDesk && options.isDefaultSiteUrlLoading
	);

	useEffect( () => {
		if ( enabled && ! isLoading && ! savedDesk && canSaveDefaultDesk ) {
			saveDeskConfig( defaultDesk );
		}
	}, [ canSaveDefaultDesk, defaultDesk, enabled, isLoading, savedDesk, saveDeskConfig ] );

	return {
		desk,
		isLoading: isLoading || isWaitingForDefaultSiteUrl,
		saveDeskConfig,
	};
}

function createDefaultDeskConfig( siteId?: string, defaultSiteUrl?: string ): DeskConfig {
	if ( siteId ) {
		return createDefaultSiteDeskConfig( defaultSiteUrl );
	}

	return defaultUserDesk;
}
