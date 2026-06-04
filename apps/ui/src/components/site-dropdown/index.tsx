import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { SyncActivityIndicator } from './sync-activity-indicator';
import { deriveSiteStatus, pickLiveSite } from './utils';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
	showSiteIcon?: boolean;
	onSettingsClick?: () => void;
};

export function SiteDropdown( {
	site,
	activeEnvironment = 'local',
	showSiteIcon = false,
	onSettingsClick,
}: Props ) {
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );
	const [ menuOpen, setMenuOpen ] = useState( false );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );

	// The trigger needs the site status for its running/stopped/transitioning
	// dot — everything else about status lives inside MainView.
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { status, statusLabel } = deriveSiteStatus( site, isStarting, isStopping );
	const siteMenuShortcut = getKeyboardShortcutDescriptor(
		getKeyboardShortcut( 'toggle-site-menu' )
	);
	useKeyboardShortcut( 'toggle-site-menu', () => setMenuOpen( ( open ) => ! open ) );

	// Only needed here so the disconnect dialog can reference the current live
	// site. MainView fetches the same data independently for its action row.
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const handleDisconnectClick = () => {
		// Close the dropdown before showing the confirmation dialog so the two
		// overlays don't stack.
		setMenuOpen( false );
		setDisconnectOpen( true );
	};

	const handleSettingsClick = onSettingsClick
		? () => {
				setMenuOpen( false );
				onSettingsClick();
		  }
		: undefined;

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
							siteName={ site.name }
							siteUrl={ getSiteDisplayUrl( site ) }
							status={ status }
							statusLabel={ statusLabel }
							environment={ activeEnvironment }
							showSiteIcon={ showSiteIcon }
							siteIconSeed={ `${ site.id }:${ site.name }:${ site.path }` }
							siteIconImage={ site.siteIcon }
							shortcut={ siteMenuShortcut }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.popup }>
					{ view === 'main' ? (
						<MainView
							site={ site }
							onSetupClick={ () => setView( 'picker' ) }
							onDisconnectClick={ handleDisconnectClick }
							onSettingsClick={ handleSettingsClick }
						/>
					) : (
						<PublishPickerView site={ site } onClose={ () => setView( 'main' ) } />
					) }
				</Menu.Popup>
			</Menu.Root>
			<SyncActivityIndicator siteId={ site.id } />
			{ liveSite ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ liveSite }
					open={ disconnectOpen }
					onOpenChange={ setDisconnectOpen }
				/>
			) : null }
		</div>
	);
}
