import { useI18nData } from 'src/hooks/use-i18n-data';
import { SupportedLocale } from 'src/lib/locale';

const BASE_DOCS_URL = 'https://developer.wordpress.com';

const AVAILABLE_DOCS_TRANSLATIONS = [ 'es' ];

function getDocsLinks( locale: SupportedLocale ) {
	let langPath = '';
	if ( AVAILABLE_DOCS_TRANSLATIONS.includes( locale ) ) {
		langPath = `/${ locale }`;
	}
	const basePath = `${ BASE_DOCS_URL }${ langPath }`;

	return {
		studio: `${ basePath }/docs/developer-tools/studio/`,
		importExport: `${ basePath }/docs/developer-tools/studio/import-export/`,
		sites: `${ basePath }/docs/developer-tools/studio/sites/`,
		sync: `${ basePath }/docs/developer-tools/studio/sync/`,
	} as const;
}

export function getDocsLink(
	locale: SupportedLocale,
	path: keyof ReturnType< typeof getDocsLinks >
) {
	const links = getDocsLinks( locale );
	return links[ path ];
}

export function useDocsLinks() {
	const { locale } = useI18nData();
	return getDocsLinks( locale );
}
