import { SiteDetailsProvider } from '../hooks/use-site-details';
import { SiteList } from './site-list';
import CreateSiteButton from './create-site-button';

export default function App() {
	return (
		<div className="p-8">
			<SiteDetailsProvider>
				<CreateSiteButton className="mb-6" />
				<SiteList />
			</SiteDetailsProvider>
		</div>
	);
}
