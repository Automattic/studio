import { I18nProvider } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { store, useRootSelector } from 'src/stores';
import { initializeUserLocale } from 'src/stores/i18n-slice';

export const I18nReduxProvider = ( { children }: { children: React.ReactNode } ) => {
	const { i18n } = useRootSelector( ( state ) => state.i18n );
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );
	return <I18nProvider i18n={ i18n }>{ children }</I18nProvider>;
};
