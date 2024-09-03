import { createI18n, I18n, defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { SupportedLocale, getLocaleData } from '../lib/locale';

interface I18nDataContext {
	setLocale: ( localeKey: SupportedLocale ) => void;
	locale: SupportedLocale;
}

const I18nDataContext = createContext< I18nDataContext >( {
	locale: 'en',
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	setLocale: () => {},
} );

export const I18nDataProvider = ( { children }: { children: React.ReactNode } ) => {
	const [ initialized, setInitialized ] = useState< boolean >( false );
	const [ i18n, setI18n ] = useState< I18n | null >( null );
	const [ locale, setLocale ] = useState< SupportedLocale >( 'en' );

	const initI18n = useCallback( async ( localeKey: SupportedLocale ) => {
		const translations = getLocaleData( localeKey )?.messages;
		const newI18n = createI18n( translations );
		setI18n( newI18n );
		// Update default I18n data to reflect language change when using
		// I18n functions from `@wordpress/i18n` package.
		// Note we need to update this in both the renderer and main processes.
		defaultI18n.setLocaleData( translations );
		getIpcApi().setDefaultLocaleData( translations );
		// App menu is reloaded to ensure the items show the translated strings.
		getIpcApi().setupAppMenu();
	}, [] );

	useEffect( () => {
		if ( initialized ) {
			initI18n( locale );
			getIpcApi().saveUserLocale( locale );
			return;
		}

		async function setUserLocale() {
			const userLocale = await getIpcApi().getUserLocale();
			setLocale( userLocale );
			setInitialized( true );
		}
		setUserLocale();
	}, [ initI18n, locale, initialized ] );

	const contextValue = useMemo(
		() => ( {
			setLocale,
			locale,
		} ),
		[ locale ]
	);

	if ( ! i18n ) {
		return null;
	}

	return (
		<I18nDataContext.Provider value={ contextValue }>
			<I18nProvider i18n={ i18n }>{ children }</I18nProvider>
		</I18nDataContext.Provider>
	);
};

export const useI18nData = () => useContext( I18nDataContext );
