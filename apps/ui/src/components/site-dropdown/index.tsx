import { useMemo } from 'react';
import * as Menu from '@/components/menu';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { useLiveWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { DropdownTrigger } from './dropdown-trigger';
import { MainView } from './main-view';
import styles from './style.module.css';
import { getSiteDropdownSecondary } from './trigger-secondary';
import { pickLatestSnapshot, pickLiveSite } from './utils';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context this defaults to local.
	activeEnvironment?: 'local' | 'live';
};

export function SiteDropdown( { site, activeEnvironment = 'local' }: Props ) {
	const connectedSites = useLiveWpcomSites( site.id );
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

	return (
		<div className={ styles.root }>
			<Menu.Root modal={ false }>
				<Menu.Trigger
					render={
						<DropdownTrigger
							siteName={ site.name }
							environment={ activeEnvironment }
							secondaryLabel={ secondary.label }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.popup }>
					<MainView site={ site } activity={ activity } />
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}
