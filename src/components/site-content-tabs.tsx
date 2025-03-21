import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { ContentTabAssistant } from 'src/components/content-tab-assistant';
import { ContentTabDatabase } from 'src/components/content-tab-database';
import { ContentTabImportExport } from 'src/components/content-tab-import-export';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabPreviews } from 'src/components/content-tab-previews';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { ContentTabSync } from 'src/components/content-tab-sync';
import Header from 'src/components/header';
import { SiteLoadingIndicator } from 'src/components/site-loading-indicator';
import { TabName, useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { WelcomeMessagesProvider } from 'src/hooks/use-welcome-messages';
import { cx } from 'src/lib/cx';

export function SiteContentTabs() {
	const { selectedSite } = useSiteDetails();
	const { importState } = useImportExport();
	const { tabs, selectedTab, setSelectedTab } = useContentTabs();
	const { __ } = useI18n();

	if ( ! selectedSite ) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<p className="text-lg text-gray-600">{ __( 'Select a site to view details.' ) }</p>
			</div>
		);
	}

	if ( selectedSite?.isAddingSite || importState[ selectedSite?.id ]?.isNewSite ) {
		return <SiteLoadingIndicator selectedSite={ selectedSite } />;
	}

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<Header />
			<WelcomeMessagesProvider>
				<TabPanel
					className="mt-6 h-full flex flex-col overflow-hidden"
					tabs={ tabs }
					orientation="horizontal"
					onSelect={ ( tabName ) => setSelectedTab( tabName as TabName ) }
					initialTabName={ selectedTab }
					key={ selectedTab }
				>
					{ ( { name } ) => (
						<div
							className={ cx(
								'h-full overflow-y-auto',
								selectedTab === 'assistant' && 'bg-gray-50'
							) }
							style={ {
								scrollbarWidth: 'thin',
								scrollbarGutter: 'stable',
							} }
						>
							{ name === 'overview' && <ContentTabOverview selectedSite={ selectedSite } /> }
							{ name === 'previews' && <ContentTabPreviews selectedSite={ selectedSite } /> }
							{ name === 'sync' && <ContentTabSync selectedSite={ selectedSite } /> }
							{ name === 'database' && <ContentTabDatabase selectedSite={ selectedSite } /> }
							{ name === 'settings' && <ContentTabSettings selectedSite={ selectedSite } /> }
							{ name === 'assistant' && (
								<ContentTabAssistant
									// TODO: Remove this key once https://github.com/Automattic/dotcom-forge/issues/10219 is fixed
									key={ selectedTab + selectedSite.id }
									selectedSite={ selectedSite }
								/>
							) }
							{ name === 'import-export' && (
								<ContentTabImportExport selectedSite={ selectedSite } />
							) }
						</div>
					) }
				</TabPanel>
			</WelcomeMessagesProvider>
		</div>
	);
}
