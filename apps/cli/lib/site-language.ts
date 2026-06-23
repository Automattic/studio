import fs from 'fs';
import path from 'path';
import { match } from '@formatjs/intl-localematcher';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { getWpFilesPath } from 'cli/lib/dependency-management/paths';
import { getAppLocale } from 'cli/lib/i18n';

interface TranslationsData {
	translations: Translation[];
}

interface Translation {
	language: string;
	english_name: string;
	native_name: string;
}

const defaultTranslation: Translation = {
	language: 'en',
	english_name: 'English (United States)',
	native_name: 'English (United States)',
};

// Tags to skip when processing languages.
// E.g. language tones are removed due to be too specific.
const SKIP_LOCALE_TAGS = [ 'formal', 'informal' ];

function getLatestVersionTranslations(): TranslationsData | undefined {
	const latestVersionTranslationsPath = path.join(
		getWpFilesPath(),
		'latest',
		'available-site-translations.json'
	);
	try {
		return JSON.parse( fs.readFileSync( latestVersionTranslationsPath, 'utf8' ) );
	} catch {
		// File doesn't exist or can't be read - will fall back to fetching from API
		return undefined;
	}
}

async function fetchTranslations( wpVersion: string ): Promise< TranslationsData | undefined > {
	let url = 'https://api.wordpress.org/translations/core/1.0/';
	if ( wpVersion !== 'latest' ) {
		url += `?version=${ wpVersion }`;
	}
	try {
		const response = await fetch( url );
		return response.json();
	} catch ( exception ) {
		console.error(
			`An error occurred when fetching available site translations for version '${ wpVersion }':`,
			exception
		);
	}
}

async function getAvailableSiteTranslations( wpVersion: string ) {
	let translationsData: TranslationsData | undefined = getLatestVersionTranslations();
	if ( wpVersion !== 'latest' || ! translationsData ) {
		try {
			translationsData = await fetchTranslations( wpVersion );
		} catch ( exception ) {
			return [ defaultTranslation ];
		}
	}
	const translations =
		translationsData?.translations.map( ( { language, english_name, native_name } ) => ( {
			language,
			english_name,
			native_name,
		} ) ) ?? [];
	return [ defaultTranslation, ...translations ];
}

export async function getPreferredSiteLanguage( wpVersion = 'latest' ): Promise< string > {
	const availableTranslations = await getAvailableSiteTranslations( wpVersion );
	const availableLanguages: string[] = availableTranslations
		// Change format to conform locale representation
		.map( ( item ) => item.language.split( '_' ).join( '-' ) )
		// Filter out invalid locales
		.filter( ( item ) => {
			try {
				new Intl.Locale( item );
				return true;
			} catch ( exception ) {
				return false;
			}
		} )
		// Filter special locales
		.filter( ( item ) => SKIP_LOCALE_TAGS.every( ( tagToSkip ) => ! item.endsWith( tagToSkip ) ) );

	const preferredLanguage = await getAppLocale();
	return match( [ preferredLanguage ], availableLanguages, DEFAULT_LOCALE )
		.split( '-' )
		.join( '_' );
}
