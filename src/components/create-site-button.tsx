import { useSiteDetails } from '../hooks/use-site-details';

export function CreateSiteButton() {
	const { createSite } = useSiteDetails();

	return (
		<button type="button" onClick={ () => createSite( '/Users/philip/dev/site-path' ) }>
			Create site
		</button>
	);
}
