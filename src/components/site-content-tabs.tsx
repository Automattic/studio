import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useContentTabs } from '../hooks/use-content-tabs';
import { useSiteDetails } from '../hooks/use-site-details';
import AddSite from './add-site';
import { ContentTabSettings } from './content-tab-settings';
import { ContentTabSnapshots } from './content-tab-snapshots';
import Header from './header';

function NoSites() {
	const { __ } = useI18n();
	return (
		<div className="w-full h-full flex items-center justify-center">
			<AddSite className="text-2xl !text-slate-400" />
		</div>
	);
}

export function SiteContentTabs() {
	const { selectedSite } = useSiteDetails();
	const tabs = useContentTabs();

	if ( ! selectedSite ) {
		return <NoSites />;
	}

	return (
		<div className="flex flex-col w-full h-full">
			<Header />
			<TabPanel className="mt-6 h-full flex flex-col" tabs={ tabs } orientation="horizontal">
				{ ( { name } ) => (
					<div className="pt-8 h-full">
						{ name === 'preview' && <ContentTabSnapshots selectedSite={ selectedSite } /> }
						{ name === 'settings' && <ContentTabSettings selectedSite={ selectedSite } /> }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
