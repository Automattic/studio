import path from 'path';
import { Locale } from '@formatjs/intl-locale';
import { match } from '@formatjs/intl-localematcher';
import fs from 'fs-extra';
import { DEFAULT_LOCALE, getPreferredSystemLanguages } from './locale';

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
	const latestVersionTranslationsPath = path.resolve(
		'wp-files',
		'latest',
		'available-site-translations.json'
	);
	try {
		return JSON.parse( fs.readFileSync( latestVersionTranslationsPath, 'utf8' ) );
	} catch ( exception ) {
		console.error(
			`An error ocurred when reading translations from '${ latestVersionTranslationsPath }':`,
			exception
		);
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
			`An error ocurred when fetching available site translations for version '${ wpVersion }':`,
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

export async function getPreferredSiteLanguage( wpVersion = 'latest' ) {
	const preferredLanguages = getPreferredSystemLanguages();
	const availableTranslations = await getAvailableSiteTranslations( wpVersion );
	const availableLanguages: string[] = availableTranslations
		// Change format to conform locale representation
		.map( ( item ) => item.language.split( '_' ).join( '-' ) )
		// Filter out invalid locales
		.filter( ( item ) => {
			try {
				new Locale( item );
				return true;
			} catch ( exception ) {
				return false;
			}
		} )
		// Filter special locales
		.filter( ( item ) => SKIP_LOCALE_TAGS.every( ( tagToSkip ) => ! item.endsWith( tagToSkip ) ) );

	return match( preferredLanguages, availableLanguages, DEFAULT_LOCALE ).split( '-' ).join( '_' );
}
