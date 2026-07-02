import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../packages/common/lib/extract-zip';
import { WP_LOCALES } from '../packages/common/lib/wp-locales';
import { fetch, sharedDispatcher, throwForHttpStatus, withRetry } from './lib/with-retry';

const WP_SERVER_FILES_PATH = path.join( import.meta.dirname, '..', 'wp-files' );

interface TranslationEntry {
	language: string;
	package: string;
}

interface TranslationsApiResponse {
	translations: TranslationEntry[];
}

// Known single-file plugins whose directory name doesn't match the WordPress.org slug.
const SINGLE_FILE_PLUGIN_SLUGS: Record< string, string > = {
	'hello.php': 'hello-dolly',
};

// Older bundled themes that aren't worth downloading translations for.
const SKIPPED_THEME_SLUGS = [ 'twentytwentythree', 'twentytwentyfour' ];

function getBundledSlugs( contentDir: string ): string[] {
	const entries = fs.readdirSync( contentDir, { withFileTypes: true } );
	const slugs: string[] = [];
	for ( const entry of entries ) {
		if ( entry.name === 'index.php' ) {
			continue;
		}
		if ( entry.isDirectory() ) {
			slugs.push( entry.name );
		} else if ( SINGLE_FILE_PLUGIN_SLUGS[ entry.name ] ) {
			slugs.push( SINGLE_FILE_PLUGIN_SLUGS[ entry.name ] );
		}
	}
	return slugs;
}

async function downloadTranslationsFromApi(
	apiUrl: string,
	destPath: string,
	label: string
): Promise< void > {
	const data = await withRetry( `language-packs:${ label }`, async () => {
		const response = await fetch( apiUrl, {
			dispatcher: sharedDispatcher,
		} );
		if ( ! response.ok ) {
			throwForHttpStatus( 'Translations API request', response.status );
		}
		return ( await response.json() ) as TranslationsApiResponse;
	} );

	const translationsToDownload = data.translations.filter( ( t ) =>
		WP_LOCALES.includes( t.language )
	);

	console.log(
		`[language-packs] Downloading ${ label } (${ translationsToDownload.length } locales) ...`
	);

	await fs.ensureDir( destPath );

	for ( const translation of translationsToDownload ) {
		const { language, package: packageUrl } = translation;
		const buffer = await withRetry( `language-packs:${ label }:${ language }`, async () => {
			const response = await fetch( packageUrl, {
				dispatcher: sharedDispatcher,
			} );
			if ( ! response.ok ) {
				throwForHttpStatus( 'Translation download', response.status );
			}
			return Buffer.from( await response.arrayBuffer() );
		} );

		const safeLabel = label.replace( /\//g, '-' );
		const zipPath = path.join( os.tmpdir(), `wp-language-${ safeLabel }-${ language }.zip` );
		await fs.writeFile( zipPath, buffer );
		await extractZip( zipPath, destPath );
		await fs.remove( zipPath );
	}
}

async function removePoAndMoFiles( dirPath: string ): Promise< void > {
	const entries = await fs.readdir( dirPath, { withFileTypes: true } );
	for ( const entry of entries ) {
		const fullPath = path.join( dirPath, entry.name );
		if ( entry.isDirectory() ) {
			await removePoAndMoFiles( fullPath );
		} else if ( entry.name.endsWith( '.po' ) || entry.name.endsWith( '.mo' ) ) {
			await fs.remove( fullPath );
		}
	}
}

async function downloadLanguagePacks(): Promise< void > {
	const languagesPath = path.join( WP_SERVER_FILES_PATH, 'latest', 'languages' );
	const wpContentPath = path.join( WP_SERVER_FILES_PATH, 'latest', 'wordpress', 'wp-content' );

	// Core translations
	await downloadTranslationsFromApi(
		'https://api.wordpress.org/translations/core/1.0/',
		languagesPath,
		'core translations'
	);

	// Plugin translations
	const pluginSlugs = getBundledSlugs( path.join( wpContentPath, 'plugins' ) );
	for ( const slug of pluginSlugs ) {
		await downloadTranslationsFromApi(
			`https://api.wordpress.org/translations/plugins/1.0/?slug=${ slug }`,
			path.join( languagesPath, 'plugins' ),
			`plugin translations: ${ slug }`
		);
	}

	// Theme translations (skip older bundled themes)
	const themeSlugs = getBundledSlugs( path.join( wpContentPath, 'themes' ) ).filter(
		( slug ) => ! SKIPPED_THEME_SLUGS.includes( slug )
	);
	for ( const slug of themeSlugs ) {
		await downloadTranslationsFromApi(
			`https://api.wordpress.org/translations/themes/1.0/?slug=${ slug }`,
			path.join( languagesPath, 'themes' ),
			`theme translations: ${ slug }`
		);
	}

	// Remove .po and .mo files — WordPress 6.5+ uses .l10n.php and .json files.
	await removePoAndMoFiles( languagesPath );
}

downloadLanguagePacks()
	.then( () => {
		console.log( '[language-packs] Done' );
	} )
	.catch( ( err ) => {
		console.error( '[language-packs] Error downloading language packs:', err );
		process.exit( 1 );
	} );
