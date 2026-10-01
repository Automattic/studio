import { _x } from '@wordpress/i18n';
import {
	getEnvironmentLabel,
	getSiteEnvironment,
} from '@/components/selective-sync/lib/environment-utils';
import styles from './remote-site-badges.module.css';
import type { SyncSite } from '@/data/core';

// Where a connected site is hosted, and its environment unless it's production.
export function RemoteSiteBadges( { site }: { site: SyncSite } ) {
	const environment = getSiteEnvironment( site );
	return (
		<>
			<span className={ styles.badge }>
				{ site.isPressable
					? _x( 'Pressable', 'hosting provider name' )
					: _x( 'WP.com', 'hosting provider name' ) }
			</span>
			{ environment !== 'production' ? (
				<span className={ styles.badge } data-environment={ environment }>
					{ getEnvironmentLabel( environment ) }
				</span>
			) : null }
		</>
	);
}
