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
	onOpenChat,
	chatTabActive,
	reserveSiteActions = true,
}: {
	start?: ReactNode;
	siteName?: string;
	site?: SiteDetails;
	onOpenChat?: () => void;
	chatTabActive?: boolean;
	reserveSiteActions?: boolean;
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
			style={ windowControlsInset > 0 ? { paddingRight: windowControlsInset + 8 } : undefined }
		>
			<div data-site-header-reserved className={ styles.headerLead }>
				{ start }
				{ site ? (
					<SiteMenu site={ site } onOpenChat={ onOpenChat } chatTabActive={ chatTabActive } />
				) : null }
				{ ! site && siteName ? (
					<>
						<GlobeIcon className={ styles.headerSiteIcon } />
						<span className={ styles.headerSite }>{ siteName }</span>
					</>
				) : null }
			</div>

			<span className={ styles.headerSpacer } aria-hidden="true" />
			{ withSiteActions && reserveSiteActions ? <SiteHeaderSpace /> : null }
		</header>
	);
}
