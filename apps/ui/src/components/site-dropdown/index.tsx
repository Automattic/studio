import { useEffect, useMemo, useRef, useState } from 'react';
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
import { consumePendingPush, usePendingPush } from '@/hooks/use-sync-connect-site-listener';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { getSiteDropdownSecondary } from './trigger-secondary';
import { deriveSiteStatus, ensureProtocol, pickLatestSnapshot, pickLiveSite } from './utils';
import type { TreeNode } from '@/components/selective-sync/tree-view';
import type { SiteDetails, SyncSite } from '@/data/core';

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
	const rootRef = useRef< HTMLDivElement >( null );
	const reopenAfterDialogRef = useRef( false );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );
	const [ disconnectSite, setDisconnectSite ] = useState< SyncSite | null >( null );
	const [ syncDialog, setSyncDialog ] = useState< {
		type: 'push' | 'pull';
		liveSite: SyncSite;
	} | null >( null );

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

	const handleDisconnectClick = ( target: SyncSite ) => {
		// Close the dropdown before showing the confirmation dialog so the two
		// overlays don't stack.
		setMenuOpen( false );
		setDisconnectSite( target );
		setDisconnectOpen( true );
	};

	const openSyncDialog = ( type: 'push' | 'pull', target: SyncSite ) => {
		// Same overlay rule as the disconnect dialog: dropdown closes first.
		setMenuOpen( false );
		setSyncDialog( { type, liveSite: target } );
	};

	const pendingPushRemoteSiteId = usePendingPush( site.id );
	useEffect( () => {
		const target = connectedSites?.find( ( { id } ) => id === pendingPushRemoteSiteId );
		if ( target && consumePendingPush( site.id ) ) {
			setMenuOpen( false );
			setSyncDialog( { type: 'push', liveSite: target } );
		}
	}, [ connectedSites, pendingPushRemoteSiteId, site.id ] );

	const startSyncFromDialog = ( start: () => void ) => {
		start();
		reopenAfterDialogRef.current = true;
		setSyncDialog( null );
	};

	// Reopen the dropdown once the dialog is gone, so the sync progress and its
	// cancel are in view. It clicks the trigger rather than setting state: Base UI
	// only clears its hover-close interaction on a real interaction, so a menu
	// opened via `setMenuOpen` dismisses itself the moment the pointer moves
	// outside it. Running in an effect (rather than a timer) guarantees the modal
	// has unmounted and returned focus first — cleanups run before this.
	useEffect( () => {
		if ( syncDialog !== null || ! reopenAfterDialogRef.current ) {
			return;
		}
		reopenAfterDialogRef.current = false;
		rootRef.current?.querySelector< HTMLElement >( '[aria-haspopup="menu"]' )?.click();
	}, [ syncDialog ] );

	const handleDialogPush = ( tree: TreeNode[] ) => {
		if ( ! syncDialog ) return;
		const target = syncDialog.liveSite;
		const options = convertTreeToPushOptions( tree );
		startSyncFromDialog( () =>
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: target.id, options, syncSite: target },
				{ onSuccess: () => void connector.openExternalUrl( ensureProtocol( target.url ) ) }
			)
		);
	};

	const handleDialogPull = ( tree: TreeNode[] ) => {
		if ( ! syncDialog ) return;
		const target = syncDialog.liveSite;
		const { optionsToSync, include_path_list: includePathList } = convertTreeToPullOptions( tree );
		startSyncFromDialog( () =>
			pullSiteFromLive.mutate( {
				siteId: site.id,
				remoteSiteId: target.id,
				options: { optionsToSync, includePathList },
				syncSite: target,
			} )
		);
	};

	return (
		<div className={ styles.root } ref={ rootRef }>
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
							onPullClick={ ( target ) => openSyncDialog( 'pull', target ) }
							onPushClick={ ( target ) => openSyncDialog( 'push', target ) }
						/>
					) : (
						<PublishPickerView site={ site } onClose={ () => setView( 'main' ) } />
					) }
				</Menu.Popup>
			</Menu.Root>
			{ disconnectSite ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ disconnectSite }
					open={ disconnectOpen }
					onOpenChange={ setDisconnectOpen }
				/>
			) : null }
			{ syncDialog ? (
				<SyncDialog
					type={ syncDialog.type }
					localSite={ site }
					remoteSite={ syncDialog.liveSite }
					onPush={ handleDialogPush }
					onPull={ handleDialogPull }
					onRequestClose={ () => setSyncDialog( null ) }
				/>
			) : null }
		</div>
	);
}
