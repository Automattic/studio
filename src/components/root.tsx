import { Provider as ReduxProvider } from 'react-redux';
import { store } from 'src/stores';
import { SyncSitesProvider } from '../hooks/sync-sites/sync-sites-context';
import { InstalledAppsProvider } from '../hooks/use-check-installed-apps';
import { ContentTabsProvider } from '../hooks/use-content-tabs';
import { FeatureFlagsProvider } from '../hooks/use-feature-flags';
import { I18nDataProvider } from '../hooks/use-i18n-data';
import { ImportExportProvider } from '../hooks/use-import-export';
import { OnboardingProvider } from '../hooks/use-onboarding';
import { PromptUsageProvider } from '../hooks/use-prompt-usage';
import { SiteDetailsProvider } from '../hooks/use-site-details';
import { SnapshotProvider } from '../hooks/use-snapshots';
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
			<ReduxProvider store={ store }>
				<I18nDataProvider>
					<AuthProvider>
						<SnapshotProvider>
							<SiteDetailsProvider>
								<FeatureFlagsProvider>
									<DemoSiteUpdateProvider>
										<ThemeDetailsProvider>
											<InstalledAppsProvider>
												<OnboardingProvider>
													<PromptUsageProvider>
														<ImportExportProvider>
															<ContentTabsProvider>
																<SyncSitesProvider>
																	<App />
																</SyncSitesProvider>
															</ContentTabsProvider>
														</ImportExportProvider>
													</PromptUsageProvider>
												</OnboardingProvider>
											</InstalledAppsProvider>
										</ThemeDetailsProvider>
									</DemoSiteUpdateProvider>
								</FeatureFlagsProvider>
							</SiteDetailsProvider>
						</SnapshotProvider>
					</AuthProvider>
				</I18nDataProvider>
			</ReduxProvider>
		</ErrorBoundary>
	);
};
export default Root;
