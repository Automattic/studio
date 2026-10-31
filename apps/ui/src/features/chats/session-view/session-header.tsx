import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useWindowControlsInset } from '@/data/host/use-window-controls-inset';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { SiteMenu, SiteHeaderSpace, useSiteHeader } from '@/features/sites';
import { GlobeIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

export function SessionHeader( {
	start,
	siteName,
	site,
	effectiveEnvironment,
}: {
	start?: ReactNode;
	siteName?: string;
	site?: SiteDetails;
	effectiveEnvironment: 'local' | 'live';
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const { host } = useSiteHeader();
	const withSiteActions = !! site && host !== null;

	return (
		<header
			data-site-header
			className={ clsx(
				styles.header,
				withSiteActions && styles.headerWithSiteActions,
				sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
			) }
			style={
				windowControlsInset > 0
					? {
							paddingRight: windowControlsInset + 8,
					  }
					: undefined
			}
		>
			<div data-site-header-reserved className={ styles.headerLead }>
				{ start }
				{ site ? <SiteMenu site={ site } /> : null }
				{ ! site && siteName ? (
					<>
						<GlobeIcon className={ styles.headerSiteIcon } />
						<span className={ styles.headerSite }>{ siteName }</span>
						<span className={ styles.headerDot } aria-hidden="true" />
						<span className={ styles.headerEnv }>
							{ effectiveEnvironment === 'live' ? __( 'Live' ) : __( 'Local' ) }
						</span>
					</>
				) : null }
			</div>
			<span className={ styles.headerSpacer } aria-hidden="true" />
			{ withSiteActions ? <SiteHeaderSpace /> : null }
		</header>
	);
}
