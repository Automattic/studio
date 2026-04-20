import { useCallback, useRef, useState } from 'react';
import type { StagingSite } from '@studio/common/types/staging-site';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import {
	useCreateStagingSiteMutation,
	useListStagingSitesQuery,
	useValidateStagingQuotaMutation,
} from 'src/stores/sync/staging-site-api';

type ProvisionState = 'idle' | 'validating' | 'provisioning' | 'ready' | 'failed';

export function useStagingProvisioning( args: {
	productionSiteId: number;
	localSiteId: string;
} ) {
	const [ state, setState ] = useState< ProvisionState >( 'idle' );
	const [ error, setError ] = useState< string | null >( null );
	const [ stagingSite, setStagingSite ] = useState< StagingSite | null >( null );
	const pollRef = useRef< ReturnType< typeof setInterval > | null >( null );
	const [ validateQuota ] = useValidateStagingQuotaMutation();
	const [ createSite ] = useCreateStagingSiteMutation();
	const [ connectSite ] = useConnectSiteMutation();
	const listQuery = useListStagingSitesQuery(
		{ productionSiteId: args.productionSiteId },
		{ skip: state !== 'provisioning' }
	);

	const start = useCallback( async () => {
		setState( 'validating' );
		setError( null );
		try {
			const quota = await validateQuota( {
				productionSiteId: args.productionSiteId,
			} ).unwrap();
			if ( ! quota.has_enough_quota ) {
				throw new Error( quota.message ?? 'Quota check failed' );
			}
			setState( 'provisioning' );
			await createSite( { productionSiteId: args.productionSiteId } ).unwrap();

			pollRef.current = setInterval( async () => {
				const refreshed = await listQuery.refetch();
				const site = refreshed.data?.[ 0 ];
				if ( site ) {
					setStagingSite( site );
					await connectSite( {
						site: {
							id: site.id,
							localSiteId: args.localSiteId,
							name: site.name,
							url: site.url,
							isStaging: true,
							isPressable: false,
							environmentType: 'staging',
							syncSupport: 'syncable',
							lastPullTimestamp: null,
							lastPushTimestamp: null,
						},
						localSiteId: args.localSiteId,
					} ).unwrap();
					setState( 'ready' );
					if ( pollRef.current ) {
						clearInterval( pollRef.current );
						pollRef.current = null;
					}
				}
			}, 5000 );
		} catch ( e: any ) {
			setError( e?.message ?? String( e ) );
			setState( 'failed' );
		}
	}, [
		args.productionSiteId,
		args.localSiteId,
		validateQuota,
		createSite,
		connectSite,
		listQuery,
	] );

	const cancel = useCallback( () => {
		if ( pollRef.current ) {
			clearInterval( pollRef.current );
			pollRef.current = null;
		}
		setState( 'idle' );
	}, [] );

	return { state, error, stagingSite, start, cancel };
}
