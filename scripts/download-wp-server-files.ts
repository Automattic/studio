import os from 'os';
import path from 'path';
import {
	PHPMYADMIN_DOWNLOAD_URL,
	PHPMYADMIN_VERSION,
	getPhpMyAdminInstallSteps,
} from '@wp-playground/tools';
import fs from 'fs-extra';
import { z } from 'zod';
import { extractZip } from '../packages/common/lib/extract-zip.ts';
import { fetch, sharedDispatcher, throwForHttpStatus, withRetry } from './lib/with-retry.ts';

const SQLITE_DATABASE_INTEGRATION_VERSION = 'v3.0.0-rc.8';
const SQLITE_DATABASE_INTEGRATION_RELEASE_URL = `https://github.com/WordPress/sqlite-database-integration/releases/download/${ SQLITE_DATABASE_INTEGRATION_VERSION }/plugin-sqlite-database-integration.zip`;

async function fetchWithRetry( name: string, url: string ): Promise< Buffer > {
	return withRetry( name, async () => {
		const response = await fetch( url, {
			dispatcher: sharedDispatcher,
		} );
		if ( ! response.ok ) {
			throwForHttpStatus( 'Request', response.status );
		}
		return Buffer.from( await response.arrayBuffer() );
	} );
}

const WP_SERVER_FILES_PATH = path.join( import.meta.dirname, '..', 'wp-files' );

// Pinned so builds are reproducible. Bump deliberately.
const WORDPRESS_IMPORTER_VERSION = '0.9.5';
const WP_LSP_VERSION = 'v0.2.0';
const PHPMYADMIN_PATCH_FILES_PATH = path.join( import.meta.dirname, '..', 'apps', 'cli', 'php' );
const PHPMYADMIN_LOCAL_PATCH_FILES = new Map< string, string >( [
	[ 'config.inc.php', path.join( PHPMYADMIN_PATCH_FILES_PATH, 'config.inc.php' ) ],
	[
		'libraries/classes/Dbal/DbiMysqli.php',
		path.join( PHPMYADMIN_PATCH_FILES_PATH, 'DbiMysqli.php' ),
	],
] );

const partialGithubReleaseSchema = z.object( {
	tag_name: z.string(),
	assets: z.array( z.object( { name: z.string(), browser_download_url: z.string() } ) ),
} );

export async function fetchLatestGithubRelease( repo: string ) {
	return withRetry( `github:${ repo }`, async () => {
		const headers: HeadersInit = {
			Accept: 'application/vnd.github.v3+json',
			'User-Agent': 'wp-studio-cli',
		};

		// GitHub API has rate limits:
		// - 60 requests/hour for unauthenticated requests
		// - 5,000 requests/hour with token authentication
		// In CI environments, the IP-based rate limit is shared across runners,
		// so we authenticate with GITHUB_TOKEN when available.
		if ( process.env.GITHUB_TOKEN ) {
			headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
		}

		const response = await fetch( `https://api.github.com/repos/${ repo }/releases/latest`, {
			headers,
			dispatcher: sharedDispatcher,
		} );

		if ( ! response.ok ) {
			throwForHttpStatus( 'GitHub API request', response.status, response.statusText );
		}

		const rawResponse: unknown = await response.json();

		return partialGithubReleaseSchema.parse( rawResponse );
	} );
}

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
			const release = await fetchLatestGithubRelease( 'automattic/wp-cli-sqlite-command' );
			const asset = release.assets[ 0 ];
			if ( ! asset ) {
				throw new Error(
					`No asset found in latest wp-cli-sqlite-command release ${ release.tag_name }`
				);
			}
			return asset.browser_download_url;
		},
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'sqlite-command' ),
	},
	{
		name: 'phpmyadmin',
		description: 'phpMyAdmin',
		getUrl: () => PHPMYADMIN_DOWNLOAD_URL,
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'phpmyadmin' ),
	},
	{
		name: 'wordpress-importer',
		description: `wordpress-importer ${ WORDPRESS_IMPORTER_VERSION }`,
		getUrl: () =>
			`https://downloads.wordpress.org/plugin/wordpress-importer.${ WORDPRESS_IMPORTER_VERSION }.zip`,
		destinationPath: WP_SERVER_FILES_PATH,
	},
	{
		name: 'reprint',
		description: `reprint.phar`,
		getUrl: () => 'https://github.com/WordPress/reprint/releases/download/v0.9.4/reprint.phar',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'reprint' ),
	},
	{
		name: 'wp-lsp',
		description: `wp-lsp ${ WP_LSP_VERSION }`,
		getUrl: () =>
			`https://github.com/draganescu/wp-lsp/releases/download/${ WP_LSP_VERSION }/wp-lsp.zip`,
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'wp-lsp' ),
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
	const buffer = await fetchWithRetry( name, url );
	await fs.writeFile( zipPath, buffer );

	if ( name === 'wp-cli' ) {
		console.log( `[${ name }] Moving WP-CLI to destination ...` );
		fs.moveSync( zipPath, path.join( extractedPath, 'wp-cli.phar' ), { overwrite: true } );
	} else if ( name === 'reprint' ) {
		console.log( `[${ name }] Moving reprint.phar to destination ...` );
		fs.moveSync( zipPath, path.join( extractedPath, 'reprint.phar' ), { overwrite: true } );
	} else if ( name === 'sqlite' ) {
		/**
		 * The SQLite database integration plugin zip extracts into a folder named
		 * plugin-sqlite-database-integration (CI-built asset format). We rename it
		 * to sqlite-database-integration which is the name expected by the rest of the app.
		 */
		console.log( `[${ name }] Extracting files from zip ...` );
		await extractZip( zipPath, extractedPath );

		const sourcePath = path.join( extractedPath, 'plugin-sqlite-database-integration' );
		const targetPath = path.join( extractedPath, 'sqlite-database-integration' );
		if ( fs.existsSync( targetPath ) ) {
			fs.rmSync( targetPath, { recursive: true, force: true } );
		}
		fs.moveSync( sourcePath, targetPath );
	} else if ( name === 'phpmyadmin' ) {
		/**
		 * phpMyAdmin is extracted into a folder like phpMyAdmin-5.2.3-english.
		 * We extract to a temp dir, rename to the destination, then inject the
		 * Playground-specific config and SQLite adapter from @wp-playground/tools.
		 */
		console.log( `[${ name }] Extracting files from zip ...` );
		const tmpExtractPath = path.join( os.tmpdir(), 'phpmyadmin-extract' );
		if ( fs.existsSync( tmpExtractPath ) ) {
			fs.rmSync( tmpExtractPath, { recursive: true, force: true } );
		}
		await extractZip( zipPath, tmpExtractPath );

		const innerFolder = `phpMyAdmin-${ PHPMYADMIN_VERSION }-english`;
		const sourcePath = path.join( tmpExtractPath, innerFolder );
		if ( fs.existsSync( extractedPath ) ) {
			fs.rmSync( extractedPath, { recursive: true, force: true } );
		}
		fs.moveSync( sourcePath, extractedPath );
		fs.rmSync( tmpExtractPath, { recursive: true, force: true } );

		// Inject Playground-specific config and SQLite adapter
		console.log( `[${ name }] Injecting Playground-specific files ...` );
		const installSteps = await getPhpMyAdminInstallSteps();
		for ( const step of installSteps ) {
			if ( step.step === 'writeFile' && typeof step.data === 'string' ) {
				// step.path is like /tools/phpmyadmin/config.inc.php — strip the /tools/phpmyadmin prefix
				const relativePath = step.path.replace( '/tools/phpmyadmin/', '' );
				const destFile = path.join( extractedPath, relativePath );
				await fs.ensureDir( path.dirname( destFile ) );

				const localPatchFile = PHPMYADMIN_LOCAL_PATCH_FILES.get( relativePath );
				const patchData = localPatchFile ? await fs.readFile( localPatchFile, 'utf8' ) : step.data;
				await fs.writeFile( destFile, patchData );
			}
		}
	} else {
		console.log( `[${ name }] Extracting files from zip ...` );
		await extractZip( zipPath, extractedPath );
	}

	console.log( `[${ name }] Files extracted` );
	await fs.remove( zipPath );
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
}

void downloadFiles();
