import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import AuthProvider from 'src/components/auth-provider';
import { WordPressStyles } from 'src/components/wordpress-styles';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { store } from 'src/stores';
import { initializeUserLocale } from 'src/stores/i18n-slice';
import { CreateProjectFlow } from './create-project/create-project-flow';
import { DotGrid } from './dot-grid';
import 'src/index.css';

const emotionCache = createCache( {
	key: 'wordpress-components',
	prepend: true,
} );

function AddSiteContent() {
	return (
		<div
			className={ cx(
				'h-screen bg-chrome flex flex-col relative overflow-hidden',
				isWindows() && 'pt-titlebar-win'
			) }
		>
			<div className="absolute inset-x-0 top-0 h-[40px] app-drag-region" />
			<div className="absolute inset-0 text-chrome-text-tertiary pointer-events-none">
				<DotGrid opacity={ 0.3 } />
			</div>
			<div className="relative z-10 flex-1 flex flex-col min-h-0">
				<CreateProjectFlow />
			</div>
		</div>
	);
}

export default function AddSiteRoot() {
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );

	return (
		<CacheProvider value={ emotionCache }>
			<ReduxProvider store={ store }>
				<I18nProvider i18n={ defaultI18n }>
					<WordPressStyles />
					<AuthProvider>
						<AddSiteContent />
					</AuthProvider>
				</I18nProvider>
			</ReduxProvider>
		</CacheProvider>
	);
}
