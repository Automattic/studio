import { useEffect, useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from '@/components/selective-sync/lib/convert-tree-to-sync-options';
import { registerSelectiveSyncConnector } from '@/components/selective-sync/lib/get-ipc-api';
import { SyncDialog } from '@/components/selective-sync/sync-dialog';
import '@/components/selective-sync/selective-sync.css';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteStarting, useIsSiteStopping, useSiteOperation } from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { getSiteDropdownSecondary } from './trigger-secondary';
import { deriveSiteStatus, ensureProtocol, pickLatestSnapshot, pickLiveSite } from './utils';
import type { TreeNode } from '@/components/selective-sync/tree-view';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
	showSiteIcon?: boolean;
	showStatus?: boolean;
	// The trigger casts a shadow when it floats over panel content (the chat
	// header). Pass false where it sits in a regular header row instead.
	floating?: boolean;
	defaultOpen?: boolean;
};

export function SiteDropdown( {
	site,
	activeEnvironment = 'local',
	showSiteIcon = false,
	showStatus = true,
	floating = true,
	defaultOpen = false,
}: Props ) {
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );
	const [ menuOpen, setMenuOpen ] = useState( defaultOpen );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );
	const [ syncDialogType, setSyncDialogType ] = useState< 'push' | 'pull' | null >( null );

	const connector = useConnector();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	// The copied selective-sync modules resolve their data calls through the
	// active connector (see selective-sync/lib/get-ipc-api.ts).
	useEffect( () => {
		registerSelectiveSyncConnector( connector );
	}, [ connector ] );

	// The trigger needs the site status for its running/stopped/transitioning
	// dot — everything else about status lives inside MainView.
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const operation = useSiteOperation( site );
	const { status, statusLabel } = deriveSiteStatus( site, isStarting, isStopping, operation );

	// Only needed here so the disconnect dialog can reference the current live
	// site. MainView fetches the same data independently for its action row.
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const { data: snapshots } = useSnapshots();
	const activity = useSiteSyncActivity( site.id );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const secondary = useMemo(
		() =>
			getSiteDropdownSecondary( {
				activity,
				activeEnvironment,
				liveSite,
				previewSnapshot,
			} ),
		[ activity, activeEnvironment, liveSite, previewSnapshot ]
	);

	const handleDisconnectClick = () => {
		// Close the dropdown before showing the confirmation dialog so the two
		// overlays don't stack.
		setMenuOpen( false );
		setDisconnectOpen( true );
	};

	const openSyncDialog = ( type: 'push' | 'pull' ) => {
		// Same overlay rule as the disconnect dialog: dropdown closes first.
		setMenuOpen( false );
		setSyncDialogType( type );
	};

	const handleDialogPush = ( tree: TreeNode[] ) => {
		if ( ! liveSite ) return;
		const options = convertTreeToPushOptions( tree );
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id, options },
			{ onSuccess: () => void connector.openExternalUrl( ensureProtocol( liveSite.url ) ) }
		);
		setSyncDialogType( null );
	};

	const handleDialogPull = ( tree: TreeNode[] ) => {
		if ( ! liveSite ) return;
		const { optionsToSync, include_path_list: includePathList } = convertTreeToPullOptions( tree );
		pullSiteFromLive.mutate( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
			options: { optionsToSync, includePathList },
		} );
		setSyncDialogType( null );
	};

	return (
		<div className={ styles.root }>
			<Menu.Root
				modal={ false }
				open={ menuOpen }
				onOpenChange={ ( open ) => {
					setMenuOpen( open );
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
							floating={ floating }
							siteName={ site.name }
							siteUrl={ getSiteDisplayUrl( site ) }
							status={ status }
							statusLabel={ statusLabel }
							environment={ activeEnvironment }
							secondaryLabel={ secondary.label }
							secondaryTone={ secondary.tone }
							showSiteIcon={ showSiteIcon }
							showStatus={ showStatus }
							siteIconSeed={ `${ site.id }:${ site.name }:${ site.path }` }
							siteIconImage={ site.siteIcon }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.popup }>
					{ view === 'main' ? (
						<MainView
							site={ site }
							activity={ activity }
							onSetupClick={ () => setView( 'picker' ) }
							onDisconnectClick={ handleDisconnectClick }
							onPullClick={ () => openSyncDialog( 'pull' ) }
							onPushClick={ () => openSyncDialog( 'push' ) }
						/>
					) : (
						<PublishPickerView site={ site } onClose={ () => setView( 'main' ) } />
					) }
				</Menu.Popup>
			</Menu.Root>
			{ liveSite ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ liveSite }
					open={ disconnectOpen }
					onOpenChange={ setDisconnectOpen }
				/>
			) : null }
			{ liveSite && syncDialogType ? (
				<SyncDialog
					type={ syncDialogType }
					localSite={ site }
					remoteSite={ liveSite }
					onPush={ handleDialogPush }
					onPull={ handleDialogPull }
					onRequestClose={ () => setSyncDialogType( null ) }
				/>
			) : null }
		</div>
	);
}
