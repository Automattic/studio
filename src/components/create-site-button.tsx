import { useSiteDetails } from '../hooks/use-site-details';

export function CreateSiteButton() {
	const { createSite } = useSiteDetails();

	return (
		<button type="button" onClick={ () => createSite( '~/site-path' ) }>
			Create site
		</button>
	);
}
