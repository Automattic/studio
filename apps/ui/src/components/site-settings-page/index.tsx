import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { SidebarToggle } from '@/components/sidebar-toggle';
import { SiteDropdown } from '@/components/site-dropdown';
import { isSiteSettingsTab, SiteSettingsForm } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useSites } from '@/data/queries/use-sites';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsInset } from '@/hooks/use-window-controls-inset';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

export function SiteSettingsPage( {
	siteId,
	activeTab,
	onTabChange,
}: {
	siteId: string;
	activeTab: SiteSettingsTabId;
	onTabChange: ( tab: SiteSettingsTabId ) => void;
} ) {
	const { data: sites, isLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const windowControlsInset = useWindowControlsInset( 'toolbar' );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}
	if ( ! site ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Site not found' ) }</h1>
				<p>{ siteId }</p>
			</div>
		);
	}

	return (
		<div className={ styles.root }>
			<div
				className={ clsx(
					styles.header,
					sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
				) }
				style={
					windowControlsInset > 0
						? {
								paddingRight: `calc(${ windowControlsInset }px + var(--wpds-dimension-padding-sm))`,
						  }
						: undefined
				}
			>
				{ sidebarCollapsed ? <SidebarToggle /> : null }
				<SiteDropdown
					site={ site }
					showSiteIcon
					showStatus={ sidebarCollapsed }
					floating={ false }
				/>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<PreviewToggleButton />
			</div>
			<div className={ styles.tabs }>
				<Tabs.Root
					selectedTabId={ activeTab }
					onSelect={ ( tabId ) => {
						if ( tabId && isSiteSettingsTab( tabId ) ) {
							onTabChange( tabId );
						}
					} }
				>
					<div className={ styles.tabsBar }>
						<Tabs.List>
							<Tabs.Tab tabId="general">{ __( 'Settings' ) }</Tabs.Tab>
							<Tabs.Tab tabId="debugging">{ __( 'Debugging' ) }</Tabs.Tab>
						</Tabs.List>
					</div>
					<div className={ styles.scroll }>
						<main className={ styles.content }>
							<SiteSettingsForm site={ site } />
						</main>
					</div>
				</Tabs.Root>
			</div>
		</div>
	);
}
