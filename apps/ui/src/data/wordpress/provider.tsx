import apiFetch from '@wordpress/api-fetch';
import { store as coreDataStore } from '@wordpress/core-data';
import { RegistryProvider, createRegistry } from '@wordpress/data';
import { useMemo, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { createSiteApiFetchHandler } from './api-fetch';

interface WordPressDataProviderProps {
	siteId: string;
	children: ReactNode;
}

export function WordPressDataProvider( { siteId, children }: WordPressDataProviderProps ) {
	const connector = useConnector();
	const registry = useMemo( () => {
		const nextRegistry = createRegistry();
		nextRegistry.register( coreDataStore );
		return nextRegistry;
	}, [] );

	apiFetch.setFetchHandler( createSiteApiFetchHandler( connector, siteId ) );

	return <RegistryProvider value={ registry }>{ children }</RegistryProvider>;
}
