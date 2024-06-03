import { PromptUsageProvider } from '../hooks/use-prompt-usage';
import { InstalledAppsProvider } from '../hooks/use-check-installed-apps';
import { OnboardingProvider } from '../hooks/use-onboarding';
import { SiteDetailsProvider } from '../hooks/use-site-details';
import { ThemeDetailsProvider } from '../hooks/use-theme-details';
import { DemoSiteUpdateProvider } from '../hooks/use-update-demo-site';
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
					<DemoSiteUpdateProvider>
						<ThemeDetailsProvider>
							<InstalledAppsProvider>
								<OnboardingProvider>
									<PromptUsageProvider>
										<App />
									</PromptUsageProvider>
								</OnboardingProvider>
							</InstalledAppsProvider>
						</ThemeDetailsProvider>
					</DemoSiteUpdateProvider>
				</SiteDetailsProvider>
			</AuthProvider>
		</ErrorBoundary>
	);
};
export default Root;
