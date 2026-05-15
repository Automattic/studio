import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
export type TabName = 'overview' | 'sync' | 'settings' | 'assistant' | 'import-export' | 'previews';
export type ContentTabContext = 'local' | 'wpcom';
type Tab = React.ComponentProps< typeof TabPanel >[ 'tabs' ][ number ] & {
	name: TabName;
};

export const getDefaultTabName = ( context: ContentTabContext ): TabName =>
	context === 'wpcom' ? 'assistant' : 'overview';

export function useTabs( context: ContentTabContext = 'local' ) {
	const { __ } = useI18n();

	return useMemo( () => {
		if ( context === 'wpcom' ) {
			const tabs: Tab[] = [
				{
					order: 1,
					name: 'assistant',
					title: __( 'Assistant' ),
				},
				{
					order: 2,
					name: 'sync',
					title: __( 'Sync' ),
				},
				{
					order: 3,
					name: 'settings',
					title: __( 'Settings' ),
				},
			];

			return tabs.sort( ( a, b ) => a.order - b.order );
		}

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
				name: 'previews',
				title: __( 'Previews' ),
			},
		];

		tabs.push(
			{
				order: 4,
				name: 'import-export',
				title: __( 'Import / Export' ),
			},
			{
				order: 5,
				name: 'settings',
				title: __( 'Settings' ),
			}
		);

		tabs.push( {
			order: 6,
			name: 'assistant',
			title: __( 'Assistant' ),
			className: 'components-tab-panel__tabs--assistant ltr:pl-8 rtl:pr-8 ltr:ml-auto rtl:mr-auto',
		} );

		return tabs.sort( ( a, b ) => a.order - b.order );
	}, [ __, context ] );
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

export function useOptionalContentTabs() {
	return useContext( ContentTabsContext );
}
