import { SiteDetailsProvider } from '../hooks/use-site-details';
import SiteList from './site-list';
import CreateSiteButton from './create-site-button';
import ErrorBoundary from './error-boundary';
import CrashTester from './crash-tester';

export default function App() {
	return (
		<div className="relative p-8 min-h-screen">
			<ErrorBoundary>
				<CrashTester />
				<SiteDetailsProvider>
					<div className="flex justify-between mb-4">
						<h1 className="text-2xl font-semibold">Sites</h1>
						<CreateSiteButton />
					</div>
					<SiteList />
				</SiteDetailsProvider>
			</ErrorBoundary>
		</div>
	);
}
