import { TabPanel } from '@wordpress/components';
import { useSiteDetails } from '../hooks/use-site-details';

interface SiteMenuProps {
	className?: string;
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const { data } = useSiteDetails();

	const tabs = data.map( ( site ) => ( {
		name: site.id,
		title: site.name,
		className: 'text-chrome-inverted',
	} ) );

	return (
		<TabPanel
			className={ className }
			tabs={ tabs }
			orientation="vertical"
			activeClass="!outline-none rounded bg-[#ffffff19]"
		>
			{ () => null }
		</TabPanel>
	);
}
