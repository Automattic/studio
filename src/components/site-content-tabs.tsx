import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useContentTabs } from '../hooks/use-content-tabs';
import { useSiteDetails } from '../hooks/use-site-details';
import ContentTabSettings from './content-tab-settings';
import { ContentTabSnapshots } from './content-tab-snapshots';
import Header from './header';

function NoSiteSelected() {
	const { __ } = useI18n();
	return (
		<div className="w-full h-full flex items-center justify-center text-2xl text-slate-400">
			{ __( 'Select a site' ) }
		</div>
	);
}

export function SiteContentTabs() {
	const { selectedSite } = useSiteDetails();
	const tabs = useContentTabs();

	if ( ! selectedSite ) {
		return <NoSiteSelected />;
	}

	return (
		<div className="flex flex-col w-full">
			<Header />
			<TabPanel className="mt-6" tabs={ tabs } orientation="horizontal">
				{ ( { name } ) => (
					<div className="pt-8">
						{ name === 'settings' && <ContentTabSettings /> }
						{ name === 'snapshots' && <ContentTabSnapshots selectedSite={ selectedSite } /> }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
