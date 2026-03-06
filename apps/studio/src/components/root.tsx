import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import App from 'src/components/app';
import AuthProvider from 'src/components/auth-provider';
import CrashTester from 'src/components/crash-tester';
import ErrorBoundary from 'src/components/error-boundary';
import { WordPressStyles } from 'src/components/wordpress-styles';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { FeatureFlagsProvider } from 'src/hooks/use-feature-flags';
import { ImportExportProvider } from 'src/hooks/use-import-export';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { OnboardingProvider } from 'src/modules/onboarding/hooks/use-onboarding';
import { store } from 'src/stores';
import { initializeUserLocale } from 'src/stores/i18n-slice';

// Create Emotion cache that injects styles first (before our Tailwind utilities)
const emotionCache = createCache( {
	key: 'wordpress-components',
	prepend: true, // This ensures WordPress component styles load before our custom styles
} );

const Root = () => {
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );
	return (
		<ErrorBoundary>
			<CrashTester />
			<CacheProvider value={ emotionCache }>
				<ReduxProvider store={ store }>
					<I18nProvider i18n={ defaultI18n }>
						<WordPressStyles />
						<AuthProvider>
							<FeatureFlagsProvider>
								<ContentTabsProvider>
									<SiteDetailsProvider>
										<ThemeDetailsProvider>
											<OnboardingProvider>
												<ImportExportProvider>
													<App />
												</ImportExportProvider>
											</OnboardingProvider>
										</ThemeDetailsProvider>
									</SiteDetailsProvider>
								</ContentTabsProvider>
							</FeatureFlagsProvider>
						</AuthProvider>
					</I18nProvider>
				</ReduxProvider>
			</CacheProvider>
		</ErrorBoundary>
	);
};
export default Root;
