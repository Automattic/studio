import { InstalledAppsProvider } from '../hooks/use-check-installed-apps';
import { OnboardingProvider } from '../hooks/use-onboarding';
import { SiteDetailsProvider } from '../hooks/use-site-details';
import { ThemeDetailsProvider } from '../hooks/use-theme-details';
import App from './app';
import AuthProvider from './auth-provider';
import CrashTester from './crash-tester';
import ErrorBoundary from './error-boundary';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<AuthProvider>
				<SiteDetailsProvider>
					<ThemeDetailsProvider>
						<InstalledAppsProvider>
							<OnboardingProvider>
								<App />
							</OnboardingProvider>
						</InstalledAppsProvider>
					</ThemeDetailsProvider>
				</SiteDetailsProvider>
			</AuthProvider>
		</ErrorBoundary>
	);
};
export default Root;
