import { renderHook, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';
import { useSiteSyncManagement } from '../use-site-sync-management';

jest.mock( '../use-auth' );
jest.mock( '../use-site-details' );
jest.mock( '../use-fetch-wpcom-sites' );
jest.mock( '../../lib/get-ipc-api' );

export const mockConnectedWpcomSites = [
	{
		id: 229386460,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: 'Site Nice',
		url: 'https://codesnippets.wpcomstaging.com',
		isStaging: false,
		stagingSiteIds: [ 238312390 ],
		syncSupport: 'syncable',
	},
	{
		id: 238312390,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: '',
		url: 'https://staging-codesnippets9.wpcomstaging.com',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
];

export const ConnectedSitesStore = {
	connectedWpcomSites: {
		'99440446': mockConnectedWpcomSites,
	},
};
