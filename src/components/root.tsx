import ErrorBoundary from './error-boundary';
import { AuthProvider } from '../lib/AuthProvider';
import CrashTester from './crash-tester';
import App from './app';
import { SiteDetailsProvider } from '../hooks/use-site-details';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<AuthProvider>
				<SiteDetailsProvider>
					<App />
				</SiteDetailsProvider>
			</AuthProvider>
		</ErrorBoundary>
	);
};
export default Root;
