import { SiteDetailsProvider } from '../hooks/use-site-details';
import SiteList from './site-list';
import CreateSiteButton from './create-site-button';
import ErrorBoundary from './error-boundary';

export default function App() {
	return (
		<div className="relative p-8 min-h-screen">
			<ErrorBoundary>
				<SiteDetailsProvider>
					<CreateSiteButton className="mb-6" />
					<SiteList />
				</SiteDetailsProvider>
			</ErrorBoundary>
		</div>
	);
}
