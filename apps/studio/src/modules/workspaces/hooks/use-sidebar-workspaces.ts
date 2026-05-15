import { useEffect, useMemo, useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { buildStudioWorkspaces } from 'src/modules/workspaces/lib/build-studio-workspaces';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';

export function useSidebarWorkspaces() {
	const { sites: localSites } = useSiteDetails();
	const { isAuthenticated, user } = useAuth();
	const { enableWorkspaces } = useFeatureFlags();
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const [ isLoadingConnectedSites, setIsLoadingConnectedSites ] = useState( false );
	const connectedSiteIds = useMemo(
		() => connectedSites.map( ( site ) => site.id ),
		[ connectedSites ]
	);
	const shouldLoadRemoteSites = enableWorkspaces && isAuthenticated;
	const {
		data: wpcomSitesData,
		isFetching: isFetchingWpcomSites,
		isLoading: isLoadingWpcomSites,
	} = useGetWpComSitesQuery(
		{
			connectedSiteIds,
			userId: user?.id,
			perPage: 100,
		},
		{ skip: ! shouldLoadRemoteSites }
	);

	useEffect( () => {
		if ( ! shouldLoadRemoteSites ) {
			setConnectedSites( [] );
			setIsLoadingConnectedSites( false );
			return;
		}

		let isCurrent = true;
		setIsLoadingConnectedSites( true );
		getIpcApi()
			.getConnectedWpcomSites()
			.then( ( sites ) => {
				if ( isCurrent ) {
					setConnectedSites( sites );
				}
			} )
			.catch( ( error ) => {
				console.error( 'Failed to load connected WordPress.com sites:', error );
				if ( isCurrent ) {
					setConnectedSites( [] );
				}
			} )
			.finally( () => {
				if ( isCurrent ) {
					setIsLoadingConnectedSites( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [ shouldLoadRemoteSites ] );

	const wpcomSites = useMemo(
		() => ( shouldLoadRemoteSites ? wpcomSitesData?.sites ?? [] : [] ),
		[ shouldLoadRemoteSites, wpcomSitesData?.sites ]
	);
	const sidebarWorkspaces = useMemo(
		() =>
			enableWorkspaces
				? buildStudioWorkspaces( {
						localSites,
						wpcomSites,
						connectedSites,
				  } )
				: [],
		[ connectedSites, enableWorkspaces, localSites, wpcomSites ]
	);

	return {
		enableWorkspaces,
		sidebarWorkspaces,
		wpcomSites,
		connectedSites,
		isLoading:
			shouldLoadRemoteSites &&
			( isLoadingConnectedSites || isLoadingWpcomSites || isFetchingWpcomSites ),
	};
}
