import { defaultI18n } from '@wordpress/i18n';
import { SupportedLocale, getLocaleData, DEFAULT_LOCALE, isSupportedLocale } from 'src/lib/locale';
import { readAppdata } from 'cli/lib/appdata';

async function getLocaleFromAppdata(): Promise< SupportedLocale | undefined > {
	try {
		const appdata = await readAppdata();
		return isSupportedLocale( appdata.locale ) ? appdata.locale : undefined;
	} catch ( error ) {
		console.error( 'Error reading appdata', error );
		return undefined;
	}
}

function getLocaleFromEnvironment(): SupportedLocale | undefined {
	const envLocale =
		process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '';
	const locale = envLocale.split( /[._]/ )[ 0 ].toLowerCase();
	return isSupportedLocale( locale ) ? locale : undefined;
}

export async function loadTranslations() {
	const appdataLocale = await getLocaleFromAppdata();
	const envLocale = getLocaleFromEnvironment();
	const locale = appdataLocale || envLocale || DEFAULT_LOCALE;
	const translations = getLocaleData( locale )?.messages;

	if ( translations ) {
		defaultI18n.setLocaleData( translations );
	} else {
		defaultI18n.resetLocaleData();
	}
}
