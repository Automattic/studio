import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { useSiteLastSyncLog, useSiteSyncActivity } from '@/data/sync-activity';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { getSiteDropdownSecondary } from './trigger-secondary';
import { deriveSiteStatus, pickLatestSnapshot, pickLiveSite } from './utils';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
	showStatus?: boolean;
};

export function SiteDropdown( { site, activeEnvironment = 'local', showStatus = true }: Props ) {
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );
	const [ menuOpen, setMenuOpen ] = useState( false );

	// The trigger needs the site status for its running/stopped/transitioning
	// dot — everything else about status lives inside MainView.
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { status, statusLabel } = deriveSiteStatus( site, isStarting, isStopping );

	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const { data: snapshots } = useSnapshots();
	const activity = useSiteSyncActivity( site.id );
	const lastSyncLog = useSiteLastSyncLog( site.id );
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
							secondaryLabel={ secondary.label }
							secondaryTone={ secondary.tone }
							showSiteIcon
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
							lastSyncLog={ lastSyncLog }
							onSetupClick={ () => setView( 'picker' ) }
						/>
					) : (
						<PublishPickerView site={ site } onClose={ () => setView( 'main' ) } />
					) }
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}
