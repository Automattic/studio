import { useCallback, useRef, useState } from 'react';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import {
	useCreateStagingSiteMutation,
	useLazyListStagingSitesQuery,
	useValidateStagingQuotaMutation,
} from 'src/stores/sync/staging-site-api';
import type { StagingSite } from '@studio/common/types/staging-site';

type ProvisionState = 'idle' | 'validating' | 'provisioning' | 'ready' | 'failed';

function toSyncSiteInput( site: StagingSite, localSiteId: string ) {
	return {
		id: site.id,
		localSiteId,
		name: site.name,
		url: site.url,
		isStaging: true,
		isPressable: false,
		environmentType: 'staging',
		syncSupport: 'syncable' as const,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

function isConflictError( err: unknown ): boolean {
	if ( ! err || typeof err !== 'object' ) return false;
	const record = err as Record< string, unknown >;
	const code = typeof record.code === 'string' ? record.code : undefined;
	const name = typeof record.name === 'string' ? record.name : undefined;
	const message = typeof record.message === 'string' ? record.message : '';
	return (
		code === 'rest_staging_site_conflict' ||
		name === 'ConflictError' ||
		/conflict/i.test( message ) ||
		/another staging site/i.test( message )
	);
}

export function useStagingProvisioning( args: { productionSiteId: number; localSiteId: string } ) {
	const [ state, setState ] = useState< ProvisionState >( 'idle' );
	const [ error, setError ] = useState< string | null >( null );
	const [ stagingSite, setStagingSite ] = useState< StagingSite | null >( null );
	const pollRef = useRef< ReturnType< typeof setInterval > | null >( null );

	const [ validateQuota ] = useValidateStagingQuotaMutation();
	const [ createSite ] = useCreateStagingSiteMutation();
	const [ connectSite ] = useConnectSiteMutation();
	const [ listStagingSites ] = useLazyListStagingSitesQuery();

	const connectAndFinish = useCallback(
		async ( site: StagingSite ) => {
			setStagingSite( site );
			await connectSite( {
				site: toSyncSiteInput( site, args.localSiteId ),
				localSiteId: args.localSiteId,
			} ).unwrap();
			setState( 'ready' );
		},
		[ args.localSiteId, connectSite ]
	);

	const start = useCallback( async () => {
		setState( 'validating' );
		setError( null );

		try {
			// 1. If a staging site already exists on wpcom for this production site,
			//    just connect it locally instead of trying to create another.
			const existing = await listStagingSites( {
				productionSiteId: args.productionSiteId,
			} ).unwrap();
			if ( existing.length > 0 ) {
				setState( 'provisioning' );
				await connectAndFinish( existing[ 0 ] );
				return;
			}

			// 2. No staging yet — check quota, then create.
			const quota = await validateQuota( {
				productionSiteId: args.productionSiteId,
			} ).unwrap();
			if ( ! quota.has_enough_quota ) {
				throw new Error( quota.message ?? 'Quota check failed' );
			}

			setState( 'provisioning' );
			try {
				await createSite( { productionSiteId: args.productionSiteId } ).unwrap();
			} catch ( createErr ) {
				// Race: between our list check and create, something registered a staging
				// site (or the list was stale). Re-list and connect if present; otherwise
				// re-throw.
				if ( isConflictError( createErr ) ) {
					const refreshed = await listStagingSites( {
						productionSiteId: args.productionSiteId,
					} ).unwrap();
					if ( refreshed.length > 0 ) {
						await connectAndFinish( refreshed[ 0 ] );
						return;
					}
				}
				throw createErr;
			}

			// 3. Poll until wpcom finishes provisioning and the site shows up in the list.
			pollRef.current = setInterval( async () => {
				try {
					const refreshed = await listStagingSites( {
						productionSiteId: args.productionSiteId,
					} ).unwrap();
					const site = refreshed[ 0 ];
					if ( site && pollRef.current ) {
						clearInterval( pollRef.current );
						pollRef.current = null;
						await connectAndFinish( site );
					}
				} catch {
					// Swallow transient list failures; the next tick will retry.
				}
			}, 5000 );
		} catch ( e ) {
			const message =
				e && typeof e === 'object' && 'message' in e
					? String( ( e as { message?: unknown } ).message ?? e )
					: String( e );
			setError( message );
			setState( 'failed' );
		}
	}, [ args.productionSiteId, listStagingSites, validateQuota, createSite, connectAndFinish ] );

	const cancel = useCallback( () => {
		if ( pollRef.current ) {
			clearInterval( pollRef.current );
			pollRef.current = null;
		}
		setState( 'idle' );
	}, [] );

	return { state, error, stagingSite, start, cancel };
}
