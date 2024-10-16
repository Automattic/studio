import { useState, useEffect } from 'react';

export type SyncSupport = 'unsupported' | 'syncable' | 'needs-transfer';

export interface SyncSite {
	id: number;
	name: string;
	url: string;
	isStaging: boolean;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
}

const FAKE_SITES: SyncSite[] = [
	{
		id: 1,
		name: 'My First Site',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 2,
		name: 'My Blog',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'unsupported',
	},
	{
		id: 3,
		name: 'My Project',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [ 4 ],
		syncSupport: 'syncable',
	},
	{
		id: 4,
		name: 'My Project',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 5,
		name: 'My Project Site with a suuuuuuper long long long name that should appear in multiple lines with a nice padding on the side, so it keeps being readable',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 6,
		name: 'My simple business site that needs a transfer',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'needs-transfer',
	},
	...Array.from( { length: 10 }, ( _, index ) => ( {
		id: index + 6,
		name: `My Pro site ${ index + 6 }`,
		url: `https://developer.wordpress.com/`,
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable' as SyncSupport,
	} ) ),
];

export function useSyncSites() {
	const [ syncSites, setSyncSites ] = useState< SyncSite[] >( [] );

	useEffect( () => {
		setSyncSites( FAKE_SITES );
	}, [] );

	return { syncSites };
}
