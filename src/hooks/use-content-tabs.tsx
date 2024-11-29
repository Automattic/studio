import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { useFeatureFlags } from './use-feature-flags';

export type TabName = 'overview' | 'share' | 'sync' | 'settings' | 'assistant' | 'import-export';
type Tab = React.ComponentProps< typeof TabPanel >[ 'tabs' ][ number ] & {
	name: TabName;
};

function useTabs() {
	const { __ } = useI18n();

	return useMemo( () => {
		const tabs: Tab[] = [
			{
				order: 1,
				name: 'overview',
				title: __( 'Overview' ),
			},
			{
				order: 2,
				name: 'sync',
				title: __( 'Sync' ),
			},
			{
				order: 3,
				name: 'share',
				title: __( 'Share' ),
			},
			{
				order: 4,
				name: 'import-export',
				title: __( 'Import / Export' ),
			},
			{
				order: 5,
				name: 'settings',
				title: __( 'Settings' ),
			},
		];

		tabs.push( {
			order: 6,
			name: 'assistant',
			title: __( 'Assistant' ),
			className: 'components-tab-panel__tabs--assistant ltr:pl-8 rtl:pr-8 ltr:ml-auto rtl:mr-auto',
		} );

		return tabs.sort( ( a, b ) => a.order - b.order );
	}, [ __ ] );
}
interface ContentTabsContextType {
	selectedTab: TabName;
	setSelectedTab: ( tab: TabName ) => void;
	tabs: React.ComponentProps< typeof TabPanel >[ 'tabs' ];
}

const ContentTabsContext = createContext< ContentTabsContextType | undefined >( undefined );

export function ContentTabsProvider( { children }: { children: ReactNode } ) {
	const tabs = useTabs();
	const [ selectedTab, setSelectedTab ] = useState< TabName >( tabs[ 0 ].name );

	return (
		<ContentTabsContext.Provider value={ { selectedTab, setSelectedTab, tabs } }>
			{ children }
		</ContentTabsContext.Provider>
	);
}

export function useContentTabs() {
	const context = useContext( ContentTabsContext );
	if ( ! context ) {
		throw new Error( 'useContentTabs must be used within a ContentTabsProvider' );
	}
	return context;
}
