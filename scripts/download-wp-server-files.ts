import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../common/lib/extract-zip';
import { WP_LOCALES } from '../common/lib/wp-locales';
import { getLatestSQLiteCommandRelease } from '../src/lib/sqlite-command-release';
import { SQLITE_DATABASE_INTEGRATION_RELEASE_URL } from '../src/constants';

const WP_SERVER_FILES_PATH = path.join( __dirname, '..', 'wp-files' );

type MaybePromise< T > = T | Promise< T >;
type FileToDownload = {
	name: string;
	description: string;
	getUrl: () => MaybePromise< string >;
	destinationPath?: string;
};

const FILES_TO_DOWNLOAD: FileToDownload[] = [
	{
		name: 'wordpress',
		description: 'latest WordPress version',
		getUrl: () => 'https://wordpress.org/latest.zip',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'latest' ),
	},
	{
		name: 'sqlite',
		description: 'SQLite files',
		getUrl: () => SQLITE_DATABASE_INTEGRATION_RELEASE_URL,
	},
	{
		name: 'wp-cli',
		description: 'WP-CLI phar file',
		getUrl: () => 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'wp-cli' ),
	},
	{
		name: 'sqlite-command',
		description: 'SQLite command',
		getUrl: async () => {
			const latestRelease = await getLatestSQLiteCommandRelease();
			return latestRelease.assets?.[ 0 ].browser_download_url ?? '';
		},
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'sqlite-command' ),
	},
];

async function downloadFile( file: FileToDownload ): Promise< void > {
	const { name, description, destinationPath } = file;
	console.log( `[${ name }] Downloading ${ description } ...` );
	const zipPath = path.join( os.tmpdir(), `${ name }.zip` );
	const extractedPath = destinationPath ?? WP_SERVER_FILES_PATH;

	try {
		await fs.ensureDir( extractedPath );
	} catch ( error ) {
		const fsError = error as { code: string };
		if ( fsError.code !== 'EEXIST' ) throw error;
	}

	const url = await file.getUrl();
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	const buffer = Buffer.from( await response.arrayBuffer() );
	await fs.writeFile( zipPath, buffer );

	if ( name === 'wp-cli' ) {
		console.log( `[${ name }] Moving WP-CLI to destination ...` );
		fs.moveSync( zipPath, path.join( extractedPath, 'wp-cli.phar' ), { overwrite: true } );
	} else if ( name === 'sqlite' ) {
		/**
		 * The SQLite database integration plugin is extracted
		 * into a folder with the version number like sqlite-database-integration-1.0.0
		 * We need to move the contents of that folder to the sqlite-database-integration folder
		 */
		console.log( `[${ name }] Extracting files from zip ...` );
		await extractZip( zipPath, extractedPath );

		const files = fs.readdirSync( extractedPath );
		const sqliteFolder = files.find( ( file ) =>
			file.startsWith( 'sqlite-database-integration-' )
		);

		if ( sqliteFolder ) {
			const sourcePath = path.join( extractedPath, sqliteFolder );
			const targetPath = path.join( extractedPath, 'sqlite-database-integration' );
			if ( fs.existsSync( targetPath ) ) {
				fs.rmSync( targetPath, { recursive: true, force: true } );
			}
			fs.renameSync( sourcePath, targetPath );
		}
	} else {
		console.log( `[${ name }] Extracting files from zip ...` );
		await extractZip( zipPath, extractedPath );
	}

	console.log( `[${ name }] Files extracted` );
	await fs.remove( zipPath );
}

interface TranslationEntry {
	language: string;
	package: string;
}

interface TranslationsApiResponse {
	translations: TranslationEntry[];
}

// Plugins and themes bundled with the default WordPress installation.
const BUNDLED_PLUGINS = [ 'akismet', 'hello-dolly' ];
const BUNDLED_THEMES = [ 'twentytwentyfive', 'twentytwentyfour', 'twentytwentythree' ];

async function downloadTranslationsFromApi(
	apiUrl: string,
	destPath: string,
	label: string
): Promise< void > {
	const response = await fetch( apiUrl );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch ${ label } translations API (status ${ response.status })` );
	}
	const data: TranslationsApiResponse = await response.json();

	const translationsToDownload = data.translations.filter( ( t ) =>
		WP_LOCALES.includes( t.language )
	);

	console.log(
		`[language-packs] Downloading ${ label } (${ translationsToDownload.length } locales) ...`
	);

	await fs.ensureDir( destPath );

	for ( const translation of translationsToDownload ) {
		const { language, package: packageUrl } = translation;
		const zipResponse = await fetch( packageUrl );
		if ( ! zipResponse.ok ) {
			console.error(
				`[language-packs] Failed to download ${ label }/${ language } (status ${ zipResponse.status }), skipping`
			);
			continue;
		}

		const safeLabel = label.replace( /\//g, '-' );
		const zipPath = path.join( os.tmpdir(), `wp-language-${ safeLabel }-${ language }.zip` );
		const buffer = Buffer.from( await zipResponse.arrayBuffer() );
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

	// Core translations
	await downloadTranslationsFromApi(
		'https://api.wordpress.org/translations/core/1.0/',
		languagesPath,
		'core translations'
	);

	// Plugin translations
	for ( const slug of BUNDLED_PLUGINS ) {
		await downloadTranslationsFromApi(
			`https://api.wordpress.org/translations/plugins/1.0/?slug=${ slug }`,
			path.join( languagesPath, 'plugins' ),
			`plugin translations: ${ slug }`
		);
	}

	// Theme translations
	for ( const slug of BUNDLED_THEMES ) {
		await downloadTranslationsFromApi(
			`https://api.wordpress.org/translations/themes/1.0/?slug=${ slug }`,
			path.join( languagesPath, 'themes' ),
			`theme translations: ${ slug }`
		);
	}

	// Remove .po and .mo files — WordPress 6.5+ uses .l10n.php and .json files.
	await removePoAndMoFiles( languagesPath );

	console.log( '[language-packs] Files extracted' );
}

async function downloadFiles() {
	for ( const file of FILES_TO_DOWNLOAD ) {
		try {
			await downloadFile( file );
		} catch ( err ) {
			console.error( err );
			process.exit( 1 );
		}
	}

	try {
		await downloadLanguagePacks();
	} catch ( err ) {
		console.error( '[language-packs] Error downloading language packs:', err );
		process.exit( 1 );
	}
}

downloadFiles();
