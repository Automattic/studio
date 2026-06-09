import { clsx } from 'clsx';
import { type CSSProperties } from 'react';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { isMacPlatform } from '@/lib/platform';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

type SiteMenuHeaderProps = {
	site?: SiteDetails;
	fallbackSiteName?: string;
	activeEnvironment?: 'local' | 'live';
	inlineBleed?: string;
};

export function SiteMenuHeader( {
	site,
	fallbackSiteName,
	activeEnvironment = 'local',
	inlineBleed,
}: SiteMenuHeaderProps ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const reserveTrafficLightSpace = sidebarCollapsed && isMacPlatform() && ! isFullscreen;
	const style = inlineBleed
		? ( { '--classic-site-menu-header-inline-bleed': inlineBleed } as CSSProperties )
		: undefined;

	return (
		<div className={ styles.header } style={ style }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ reserveTrafficLightSpace ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				{ site ? (
					<div className={ styles.menuSlot }>
						<SiteDropdown
							site={ site }
							activeEnvironment={ activeEnvironment }
							showSiteIcon={ sidebarCollapsed }
						/>
					</div>
				) : fallbackSiteName ? (
					<SiteMenuFallback siteName={ fallbackSiteName } showSiteIcon={ sidebarCollapsed } />
				) : null }
				<span className={ styles.headerSpacer } aria-hidden="true" />
			</div>
		</div>
	);
}

function SiteMenuFallback( {
	siteName,
	showSiteIcon,
}: {
	siteName: string;
	showSiteIcon: boolean;
} ) {
	return (
		<div className={ styles.fallback }>
			{ showSiteIcon ? <SiteIcon className={ styles.fallbackIcon } seed={ siteName } /> : null }
			<span className={ styles.fallbackStatus } aria-hidden="true" />
			<span className={ styles.fallbackSite }>{ siteName }</span>
		</div>
	);
}
