import { HelmetProvider } from 'react-helmet-async';
import { Provider as ReduxProvider } from 'react-redux';
import App from 'src/components/app';
import AuthProvider from 'src/components/auth-provider';
import CrashTester from 'src/components/crash-tester';
import ErrorBoundary from 'src/components/error-boundary';
import { SyncSitesProvider } from 'src/hooks/sync-sites/sync-sites-context';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { FeatureFlagsProvider } from 'src/hooks/use-feature-flags';
import { I18nDataProvider } from 'src/hooks/use-i18n-data';
import { ImportExportProvider } from 'src/hooks/use-import-export';
import { OnboardingProvider } from 'src/hooks/use-onboarding';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { store } from 'src/stores';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<ReduxProvider store={ store }>
				<HelmetProvider>
					<I18nDataProvider>
						<AuthProvider>
							<SiteDetailsProvider>
								<FeatureFlagsProvider>
									<ThemeDetailsProvider>
										<OnboardingProvider>
											<ImportExportProvider>
												<ContentTabsProvider>
													<SyncSitesProvider>
														<App />
													</SyncSitesProvider>
												</ContentTabsProvider>
											</ImportExportProvider>
										</OnboardingProvider>
									</ThemeDetailsProvider>
								</FeatureFlagsProvider>
							</SiteDetailsProvider>
						</AuthProvider>
					</I18nDataProvider>
				</HelmetProvider>
			</ReduxProvider>
		</ErrorBoundary>
	);
};
export default Root;
