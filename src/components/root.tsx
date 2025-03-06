import { Provider as ReduxProvider } from 'react-redux';
import App from 'src/components/app';
import AuthProvider from 'src/components/auth-provider';
import CrashTester from 'src/components/crash-tester';
import ErrorBoundary from 'src/components/error-boundary';
import { ThemeModeProvider } from 'src/hooks/use-theme-mode';
import { SyncSitesProvider } from 'src/hooks/sync-sites/sync-sites-context';
import { InstalledAppsProvider } from 'src/hooks/use-check-installed-apps';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { FeatureFlagsProvider } from 'src/hooks/use-feature-flags';
import { I18nDataProvider } from 'src/hooks/use-i18n-data';
import { ImportExportProvider } from 'src/hooks/use-import-export';
import { OnboardingProvider } from 'src/hooks/use-onboarding';
import { PromptUsageProvider } from 'src/hooks/use-prompt-usage';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { SnapshotProvider } from 'src/hooks/use-snapshots';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { DemoSiteUpdateProvider } from 'src/hooks/use-update-demo-site';
import { store } from 'src/stores';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<ReduxProvider store={ store }>
				<I18nDataProvider>
					<ThemeModeProvider>
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
					</ThemeModeProvider>
				</I18nDataProvider>
			</ReduxProvider>
		</ErrorBoundary>
	);
};
export default Root;