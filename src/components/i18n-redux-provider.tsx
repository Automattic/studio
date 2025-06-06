import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { store } from 'src/stores';
import { initializeUserLocale } from 'src/stores/i18n-slice';

export const I18nReduxProvider = ( { children }: { children: React.ReactNode } ) => {
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );
	return <I18nProvider i18n={ defaultI18n }>{ children }</I18nProvider>;
};
