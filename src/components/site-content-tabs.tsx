import { __ } from '@wordpress/i18n';
import { useSiteDetails } from '../hooks/use-site-details';

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
			<div className="flex w-full justify-end gap-2.5">
				<h1 className="text-black text-xl text-normal leading-7 capitalize mr-auto">
					{ selectedSite.name }
				</h1>
				{ /* TODO: Add the header here */ }
			</div>
		</div>
	);
}
