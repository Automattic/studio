import { defaultI18n } from '@wordpress/i18n';
import {
	SupportedLocale,
	getLocaleData,
	DEFAULT_LOCALE,
	isSupportedLocale,
} from 'common/lib/locale';
import { readAppdata } from 'cli/lib/appdata';
// Yargs locale files imported directly so they're inlined in the bundle.
// y18n's file-based locale resolution breaks after Vite bundling because the
// resolved directory path no longer matches the actual location of locale files.
import yargsLocaleDe from '../../node_modules/yargs/locales/de.json';
import yargsLocaleEs from '../../node_modules/yargs/locales/es.json';
import yargsLocaleFr from '../../node_modules/yargs/locales/fr.json';
import yargsLocaleHe from '../../node_modules/yargs/locales/he.json';
import yargsLocaleHu from '../../node_modules/yargs/locales/hu.json';
import yargsLocaleId from '../../node_modules/yargs/locales/id.json';
import yargsLocaleIt from '../../node_modules/yargs/locales/it.json';
import yargsLocaleJa from '../../node_modules/yargs/locales/ja.json';
import yargsLocaleKo from '../../node_modules/yargs/locales/ko.json';
import yargsLocaleNl from '../../node_modules/yargs/locales/nl.json';
import yargsLocalePl from '../../node_modules/yargs/locales/pl.json';
import yargsLocalePtBR from '../../node_modules/yargs/locales/pt_BR.json';
import yargsLocaleRu from '../../node_modules/yargs/locales/ru.json';
import yargsLocaleTr from '../../node_modules/yargs/locales/tr.json';
import yargsLocaleUkUA from '../../node_modules/yargs/locales/uk_UA.json';
import yargsLocaleZhCN from '../../node_modules/yargs/locales/zh_CN.json';
import yargsLocaleZhTW from '../../node_modules/yargs/locales/zh_TW.json';

const yargsLocaleDataMap: Partial< Record< SupportedLocale, Record< string, unknown > > > = {
	de: yargsLocaleDe,
	es: yargsLocaleEs,
	fr: yargsLocaleFr,
	he: yargsLocaleHe,
	hu: yargsLocaleHu,
	id: yargsLocaleId,
	it: yargsLocaleIt,
	ja: yargsLocaleJa,
	ko: yargsLocaleKo,
	nl: yargsLocaleNl,
	pl: yargsLocalePl,
	'pt-br': yargsLocalePtBR,
	ru: yargsLocaleRu,
	tr: yargsLocaleTr,
	uk: yargsLocaleUkUA,
	'zh-cn': yargsLocaleZhCN,
	'zh-tw': yargsLocaleZhTW,
};

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

function mapToYargsLocale( locale: SupportedLocale ): string {
	switch ( locale ) {
		case 'pt-br':
			return 'pt_BR';
		case 'uk':
			return 'uk_UA';
		case 'zh-cn':
			return 'zh_CN';
		case 'zh-tw':
			return 'zh_TW';
		default:
			return locale;
	}
}

export async function getAppLocale(): Promise< SupportedLocale > {
	const appdataLocale = await getLocaleFromAppdata();
	const envLocale = getLocaleFromEnvironment();
	return appdataLocale || envLocale || DEFAULT_LOCALE;
}

export async function loadTranslations(): Promise< {
	yargsLocale: string;
	yargsLocaleData: Record< string, unknown > | undefined;
} > {
	const locale = await getAppLocale();
	const translations = getLocaleData( locale )?.messages;

	if ( translations ) {
		defaultI18n.setLocaleData( translations );
	} else {
		defaultI18n.resetLocaleData();
	}

	return {
		yargsLocale: mapToYargsLocale( locale ),
		yargsLocaleData: yargsLocaleDataMap[ locale ],
	};
}
