import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import {
	connectedWpcomSitesQueryKey,
	useConnectedWpcomSites,
} from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { SyncActivityIndicator } from './sync-activity-indicator';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
} from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
};

export function SiteDropdown( { site, activeEnvironment = 'local' }: Props ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );

	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const pickableSites = usePickableWpcomSites( { enabled: view === 'picker' } );

	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	// Preview / push / pull are mutually exclusive against the same local
	// site — pull stops + restarts the server, so running it mid-push (or
	// vice-versa) would wedge the site runtime.
	const isSyncing =
		publishPreviewSite.isPending || pushSiteToLive.isPending || pullSiteFromLive.isPending;

	const { status, statusLabel, localSublabel } = deriveSiteStatus( site, isStarting, isStopping );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handleToggleServer = () => {
		if ( status === 'transitioning' ) {
			return;
		}
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	const handlePreviewClick = () => {
		if ( publishPreviewSite.isPending ) {
			return;
		}
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( ensureProtocol( url ) ) }
		);
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id },
			{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
		);
	};

	const handleSetupClick = () => {
		if ( isSyncing ) {
			return;
		}
		// No live site yet — let the user pick an existing WordPress.com site
		// to connect to, or link out to the checkout flow to create a new one.
		// Both options live in the picker view so the dropdown doesn't grow
		// unbounded in its default state.
		setView( 'picker' );
	};

	const handlePickWpcomSite = async ( pickedSite: SyncSite ) => {
		try {
			await connector.connectWpcomSite( site.id, {
				...pickedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( site.id ),
			} );
			setView( 'main' );
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: pickedSite.id },
				{ onSuccess: () => openExternal( ensureProtocol( pickedSite.url ) ) }
			);
		} catch ( error ) {
			console.error( 'Failed to connect WordPress.com site:', error );
		}
	};

	const handleCreateNewSite = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			openExternal( checkoutUrl );
		}
		// The deep-link listener handles the follow-up connection once the
		// user finishes checkout, so we just close the picker here.
		setView( 'main' );
	};

	return (
		<div className={ styles.root }>
			<Menu.Root
				modal={ false }
				onOpenChange={ ( open ) => {
					// Reset to the main view whenever the dropdown closes so the
					// next opening doesn't unexpectedly land in the picker state.
					if ( ! open ) {
						setView( 'main' );
					}
				} }
			>
				<Menu.Trigger
					render={
						<DropdownTrigger
							siteName={ site.name }
							siteUrl={ getSiteDisplayUrl( site ) }
							status={ status }
							statusLabel={ statusLabel }
							environment={ activeEnvironment }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.popup }>
					{ view === 'main' ? (
						<MainView
							site={ site }
							liveSite={ liveSite }
							previewSnapshot={ previewSnapshot }
							status={ status }
							localSublabel={ localSublabel }
							isStopping={ isStopping }
							isSyncing={ isSyncing }
							isPreviewPending={ publishPreviewSite.isPending }
							isPushPending={ pushSiteToLive.isPending }
							isPullPending={ pullSiteFromLive.isPending }
							onToggleServer={ handleToggleServer }
							onOpenExternal={ openExternal }
							onPreviewClick={ handlePreviewClick }
							onPushClick={ handlePushClick }
							onPullClick={ handlePullClick }
							onSetupClick={ handleSetupClick }
						/>
					) : (
						<PublishPickerView
							pickableSites={ pickableSites.data }
							isLoading={ pickableSites.isLoading }
							onBack={ () => setView( 'main' ) }
							onPickSite={ handlePickWpcomSite }
							onCreateNew={ handleCreateNewSite }
						/>
					) }
				</Menu.Popup>
			</Menu.Root>
			<SyncActivityIndicator siteId={ site.id } />
		</div>
	);
}
