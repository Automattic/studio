import { useCallback } from 'react';
import { SupportedLocale } from 'common/lib/locale';
import { useI18nData } from 'src/hooks/use-i18n-data';

const BASE_DOCS_URL = 'https://developer.wordpress.com' as const;

const DOCS_LINKS = {
	studio: '/docs/developer-tools/studio/',
	importExport: '/docs/developer-tools/studio/import-export/',
	sites: '/docs/developer-tools/studio/sites/',
	sync: '/docs/developer-tools/studio/sync/',
} as const;

const AVAILABLE_DOCS_TRANSLATIONS: SupportedLocale[] = [ 'es' ];

export function getDocsLink( locale: SupportedLocale, path: keyof typeof DOCS_LINKS ) {
	let langPath = '';
	if ( AVAILABLE_DOCS_TRANSLATIONS.includes( locale ) ) {
		langPath = `/${ locale }`;
	}
	const basePath = `${ BASE_DOCS_URL }${ langPath }`;

	return `${ basePath }${ DOCS_LINKS[ path ] }`;
}

export function useDocsLink() {
	const { locale } = useI18nData();
	return useCallback(
		( path: keyof typeof DOCS_LINKS ) => getDocsLink( locale, path ),
		[ locale ]
	);
}
