import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useContentTabs } from '../hooks/use-content-tabs';
import { useSiteDetails } from '../hooks/use-site-details';
import { WelcomeMessagesProvider } from '../hooks/use-welcome-messages';
import { ContentTabAssistant } from './content-tab-assistant';
import { ContentTabImportExport } from './content-tab-import-export';
import { ContentTabOverview } from './content-tab-overview';
import { ContentTabSettings } from './content-tab-settings';
import { ContentTabSnapshots } from './content-tab-snapshots';
import Header from './header';
import { SiteLoadingIndicator } from './site-loading-indicator';

export function SiteContentTabs() {
	const { selectedSite } = useSiteDetails();
	const tabs = useContentTabs();
	const { __ } = useI18n();

	if ( ! selectedSite ) {
		return (
			<div className="w-full h-full flex items-center justify-center">
				<p className="text-lg text-gray-600">{ __( 'Select a site to view details.' ) }</p>
			</div>
		);
	}

	if ( selectedSite?.isAddingSite ) {
		return <SiteLoadingIndicator selectedSiteName={ selectedSite.name } />;
	}

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<Header />
			<WelcomeMessagesProvider>
				<TabPanel
					className="mt-6 h-full flex flex-col overflow-hidden"
					tabs={ tabs }
					orientation="horizontal"
				>
					{ ( { name } ) => (
						<div className="h-full">
							{ name === 'overview' && <ContentTabOverview selectedSite={ selectedSite } /> }
							{ name === 'share' && <ContentTabSnapshots selectedSite={ selectedSite } /> }
							{ name === 'settings' && <ContentTabSettings selectedSite={ selectedSite } /> }
							{ name === 'assistant' && <ContentTabAssistant selectedSite={ selectedSite } /> }
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
