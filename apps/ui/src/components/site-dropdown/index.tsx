import { useState } from 'react';
import * as Menu from '@/components/menu';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import { SyncActivityIndicator } from './sync-activity-indicator';
import { deriveSiteStatus } from './utils';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
};

export function SiteDropdown( { site, activeEnvironment = 'local' }: Props ) {
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );

	// The trigger needs the site status for its running/stopped/transitioning
	// dot — everything else about status lives inside MainView.
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { status, statusLabel } = deriveSiteStatus( site, isStarting, isStopping );

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
						<MainView site={ site } onSetupClick={ () => setView( 'picker' ) } />
					) : (
						<PublishPickerView site={ site } onClose={ () => setView( 'main' ) } />
					) }
				</Menu.Popup>
			</Menu.Root>
			<SyncActivityIndicator siteId={ site.id } />
		</div>
	);
}
