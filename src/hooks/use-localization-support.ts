import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { useI18nData } from './use-i18n-data';

export function useLocalizationSupport() {
	const { __, _x, isRTL } = useI18n();
	const { locale } = useI18nData();

	// Some languages may need to set an html lang attribute that is different from their slug
	let lang = __( 'html_lang_attribute' );

	// Some languages don't have the translation for html_lang_attribute
	// or maybe we are dealing with the default `en` locale. Return the general purpose locale slug
	if ( lang === 'html_lang_attribute' ) {
		lang = locale;
	}

	useEffect( () => {
		if ( lang ) {
			document.documentElement.lang = lang;
		}
	}, [ lang ] );

	// RTL detection (like `isRTL()`) works by looking up the translation of the special string `ltr`.
	// We ensure `ltr` is added to the dictionary by using it here.
	_x( 'ltr', 'text direction' );

	const isRtl = isRTL();

	useEffect( () => {
		document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
	}, [ isRtl ] );

	return null;
}
