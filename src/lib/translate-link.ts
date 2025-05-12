import { SupportedLocale } from 'common/lib/locale';

const BASE_DOCS_URL = 'https://developer.wordpress.com/docs';

export const DOCS_LINKS = {
	studio: `${ BASE_DOCS_URL }/developer-tools/studio/`,
	importExport: `${ BASE_DOCS_URL }/developer-tools/studio/import-export/`,
	sites: `${ BASE_DOCS_URL }/developer-tools/studio/sites/`,
	sync: `${ BASE_DOCS_URL }/developer-tools/studio/sync/`,
	cli: `${ BASE_DOCS_URL }/developer-tools/studio/cli/`,
};

function translateDocsLink( locale: SupportedLocale, url: string ): string {
	const availableDocsTranslations: SupportedLocale[] = [ 'es' ];
	if ( ! availableDocsTranslations.includes( locale ) || ! url.startsWith( BASE_DOCS_URL ) ) {
		return url;
	}
	return url.replace( BASE_DOCS_URL, `https://developer.wordpress.com/${ locale }/docs` );
}

export const BLOG_LINKS = {
	'php-versions': 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/',
	'preview-sites': 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/',
	'custom-domains-https': 'https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/',
};

const BLOG_TRANSLATIONS: Map< string, Partial< Record< SupportedLocale, string > > > = new Map( [
	[
		BLOG_LINKS[ 'php-versions' ],
		{
			es: 'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/',
			fr: 'https://wordpress.com/fr/blog/2025/03/28/studio-wordpress-php-versions/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/',
		},
	],
	[
		BLOG_LINKS[ 'preview-sites' ],
		{
			es: 'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/',
			fr: 'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/',
			ja: 'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/',
		},
	],
	[
		BLOG_LINKS[ 'custom-domains-https' ],
		{
			es: 'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/03/estudio-dominios-personalizados-https/',
		},
	],
] );

export function translateLink( locale: SupportedLocale, url: string ): string {
	if ( url.startsWith( BASE_DOCS_URL ) ) {
		return translateDocsLink( locale, url );
	}

	const translation = BLOG_TRANSLATIONS.get( url )?.[ locale ];
	if ( translation ) {
		return translation;
	}
	return url;
}
