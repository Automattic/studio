import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import App from 'src/components/app';
import AuthProvider from 'src/components/auth-provider';
import CrashTester from 'src/components/crash-tester';
import ErrorBoundary from 'src/components/error-boundary';
import { SyncSitesProvider } from 'src/hooks/sync-sites/sync-sites-context';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { FeatureFlagsProvider } from 'src/hooks/use-feature-flags';
import { ImportExportProvider } from 'src/hooks/use-import-export';
import { OnboardingProvider } from 'src/hooks/use-onboarding';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { store } from 'src/stores';
import { initializeUserLocale } from 'src/stores/i18n-slice';

const Root = () => {
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );
	return (
		<ErrorBoundary>
			<CrashTester />
			<ReduxProvider store={ store }>
				<I18nProvider i18n={ defaultI18n }>
					<AuthProvider>
						<ContentTabsProvider>
							<SiteDetailsProvider>
								<FeatureFlagsProvider>
									<ThemeDetailsProvider>
										<OnboardingProvider>
											<ImportExportProvider>
												<SyncSitesProvider>
													<App />
												</SyncSitesProvider>
											</ImportExportProvider>
										</OnboardingProvider>
									</ThemeDetailsProvider>
								</FeatureFlagsProvider>
							</SiteDetailsProvider>
						</ContentTabsProvider>
					</AuthProvider>
				</I18nProvider>
			</ReduxProvider>
		</ErrorBoundary>
	);
};
export default Root;
