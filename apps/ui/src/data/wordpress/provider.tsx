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

const siteRegistries = new Map< string, ReturnType< typeof createRegistry > >();

function getSiteRegistry( siteId: string ) {
	const cachedRegistry = siteRegistries.get( siteId );
	if ( cachedRegistry ) {
		return cachedRegistry;
	}

	const registry = createRegistry();
	registry.register( coreDataStore );
	siteRegistries.set( siteId, registry );
	return registry;
}

export function WordPressDataProvider( { siteId, children }: WordPressDataProviderProps ) {
	const connector = useConnector();
	const registry = useMemo( () => getSiteRegistry( siteId ), [ siteId ] );
	const fetchHandler = useMemo(
		() => createSiteApiFetchHandler( connector, siteId ),
		[ connector, siteId ]
	);

	apiFetch.setFetchHandler( fetchHandler );

	return <RegistryProvider value={ registry }>{ children }</RegistryProvider>;
}
