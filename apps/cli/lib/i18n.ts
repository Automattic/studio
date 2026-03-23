import {
	SupportedLocale,
	getLocaleData,
	DEFAULT_LOCALE,
	isSupportedLocale,
} from '@studio/common/lib/locale';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { defaultI18n } from '@wordpress/i18n';

async function getLocaleFromSharedConfig(): Promise< SupportedLocale | undefined > {
	try {
		const config = await readSharedConfig();
		return isSupportedLocale( config.locale ) ? config.locale : undefined;
	} catch {
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
	const appdataLocale = await getLocaleFromSharedConfig();
	const envLocale = getLocaleFromEnvironment();
	return appdataLocale || envLocale || DEFAULT_LOCALE;
}

export async function loadTranslations() {
	const locale = await getAppLocale();
	const translations = getLocaleData( locale )?.messages;

	if ( translations ) {
		defaultI18n.setLocaleData( translations );
	} else {
		defaultI18n.resetLocaleData();
	}

	return mapToYargsLocale( locale );
}
