import { SupportedLocale } from 'common/lib/locale';

const URL_TRANSLATIONS: Map< string, Partial< Record< SupportedLocale, string > > > = new Map( [
	[
		'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/',
		{
			es: 'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/',
			fr: 'https://wordpress.com/fr/blog/2025/03/28/studio-wordpress-php-versions/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/',
		},
	],
	[
		'https://wordpress.com/blog/2025/02/24/studio-preview-sites/',
		{
			es: 'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/',
			fr: 'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/',
			ja: 'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/',
		},
	],
	[
		'https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/',
		{
			es: 'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/',
			'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/03/estudio-dominios-personalizados-https/',
		},
	],
] );

export function translateLink( locale: SupportedLocale, url: string ): string {
	const translation = URL_TRANSLATIONS.get( url )?.[ locale ];
	if ( translation ) {
		return translation;
	}
	return url;
}
