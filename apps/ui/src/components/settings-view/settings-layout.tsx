import { __ } from '@wordpress/i18n';
import * as Tabs from '@/components/tabs';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export const SETTINGS_TABS = [ 'preferences' ] as const;
export type SettingsTabId = ( typeof SETTINGS_TABS )[ number ];

export function isSettingsTab( value: string ): value is SettingsTabId {
	return ( SETTINGS_TABS as readonly string[] ).includes( value );
}

function SettingsHeader() {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;
	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
		</div>
	);
}

type Props = {
	activeTab: SettingsTabId;
	onTabChange: ( tab: SettingsTabId ) => void;
	children: ReactNode;
};

export function SettingsLayout( { activeTab, onTabChange, children }: Props ) {
	return (
		<div className={ styles.root }>
			<SettingsHeader />
			<Tabs.Root
				selectedTabId={ activeTab }
				onSelect={ ( tabId ) => {
					if ( tabId && isSettingsTab( tabId ) ) {
						onTabChange( tabId );
					}
				} }
			>
				<div className={ styles.titleBlock }>
					<h1>{ __( 'Settings' ) }</h1>
				</div>
				<div className={ styles.tabsBar }>
					<div className={ styles.tabsBarInner }>
						<Tabs.List>
							<Tabs.Tab tabId="preferences">{ __( 'Preferences' ) }</Tabs.Tab>
						</Tabs.List>
					</div>
				</div>
				<div className={ styles.scroll }>
					<div className={ styles.contentBlock }>{ children }</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
