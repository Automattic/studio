import { __ } from '@wordpress/i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import Header from './header';

function NoSiteSelected() {
	return (
		<div className="w-full h-full flex items-center justify-center text-2xl text-slate-400">
			{ __( 'Select a site' ) }
		</div>
	);
}

export function SiteContentTabs() {
	const { selectedSite } = useSiteDetails();

	if ( ! selectedSite ) {
		return <NoSiteSelected />;
	}

	return (
		<div className="flex w-full">
			<Header />
		</div>
	);
}
