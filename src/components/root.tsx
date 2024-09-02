import { ChatProvider } from '../hooks/use-chat-context';
import { InstalledAppsProvider } from '../hooks/use-check-installed-apps';
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
													<ChatProvider>
														<ImportExportProvider>
															<App />
														</ImportExportProvider>
													</ChatProvider>
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
		</ErrorBoundary>
	);
};
export default Root;
