/**
 * CLI command: studio site import
 *
 * Imports a remote WordPress site into a local Studio site using the
 * streaming site migration protocol. Delegates all protocol work to
 * importer.phar (run via PHP WASM), then sets up the imported files
 * as a Studio site with SQLite and URL rewriting.
 *
 * The import flow:
 *   1. Preflight – verify the remote plugin is reachable (cached, runs once)
 *   2. files-sync – download all WordPress files via importer.phar
 *   3. db-sync – download the SQL dump via importer.phar
 *   4. Create a Studio site from the downloaded files
 *   5. Apply the database dump directly to SQLite via db-apply,
 *      rewriting URLs (http + https variants → localhost) in the same pass
 *
 * Resumption: import state is persisted in the Studio appdata directory,
 * keyed by URL. If the command dies mid-import, re-running the same
 * command will resume from where it left off. The importer.phar natively
 * supports resuming partial file and database downloads.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { isEmptyDir, pathExists, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { portFinder } from '@studio/common/lib/port-finder';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { sortSites } from '@studio/common/lib/sort-sites';
import { ImportCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import {
	getAppdataDirectory,
	lockAppdata,
	readAppdata,
	removeSiteFromAppdata,
	saveAppdata,
	SiteData,
	unlockAppdata,
} from 'cli/lib/appdata';
import { emitSiteEvent } from 'cli/lib/daemon-client';
import { getDefaultSitePath } from 'cli/lib/generate-site-name';
import { runImporterCommandUntilComplete, ImporterResult } from 'cli/lib/import/migration-client';
import { getServerFilesPath } from 'cli/lib/server-files';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

/**
 * Extracts JSON from importer.phar output, tolerating PHP warnings
 * that may appear before the JSON payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseImporterJson( result: ImporterResult ): any {
	const raw = result.stdout.trim();
	try {
		return JSON.parse( raw );
	} catch {
		// stdout may contain PHP warnings before the JSON object
		const jsonStart = raw.indexOf( '{' );
		if ( jsonStart >= 0 ) {
			return JSON.parse( raw.slice( jsonStart ) );
		}
		throw new LoggerError(
			`importer.phar did not return valid JSON.\nstdout: ${ raw }\nstderr: ${ result.stderr }`
		);
	}
}

export async function runCommand( url: string, secret: string, name: string ): Promise< void > {
	const apiUrl = url.replace( /\/+$/, '' ) + '/?site-export-api';
	const siteName = name;
	let sitePath: string | undefined;
	let siteId: string | undefined;

	// Ensure we have the latest importer.phar (older versions don't support db-apply)
	const cachedPharPath = path.join( getAppdataDirectory(), 'importer.phar' );
	try {
		fs.unlinkSync( cachedPharPath );
	} catch {
		// File may not exist yet
	}

	// Use a persistent import directory so the phar can resume partial
	// downloads if the command is interrupted and re-run. The hash
	// includes both URL and name so the same site can be imported
	// under different names without collisions.
	const importDirHash = crypto
		.createHash( 'sha256' )
		.update( `${ url }\n${ siteName }` )
		.digest( 'hex' )
		.slice( 0, 12 );
	const importDir = path.join( getAppdataDirectory(), 'imports', importDirHash );
	const stateDir = path.join( importDir, 'state' );
	const docroot = path.join( importDir, 'docroot' );
	fs.mkdirSync( stateDir, { recursive: true } );
	fs.mkdirSync( docroot, { recursive: true } );

	const isResume = fs.readdirSync( stateDir ).length > 0;
	if ( isResume ) {
		console.log( `Resuming previous import for ${ url }` );
		console.log( '' );
	}

	console.log( `Importing "${ siteName }" from ${ url }` );
	console.log( `Import directory: ${ importDir }` );
	console.log( '' );

	try {
		// ── Step 1: Preflight ────────────────────────────────────────
		// Cache the preflight result in the state directory so we only
		// hit the remote once. On resume, read the cached result.
		const preflightCachePath = path.join( stateDir, 'preflight.json' );
		let preflight: {
			siteurl?: string;
			wp_version?: string;
			php_version?: string;
			table_prefix?: string;
		};

		if ( fs.existsSync( preflightCachePath ) ) {
			preflight = JSON.parse( fs.readFileSync( preflightCachePath, 'utf-8' ) );
			logger.reportSuccess(
				`Connected – WordPress ${ preflight.wp_version || 'unknown' }, ` +
					`PHP ${ preflight.php_version || 'unknown' }`
			);
		} else {
			logger.reportStart( LoggerAction.PREFLIGHT, __( 'Connecting to remote site…' ) );

			// /state and /docroot are virtual mount points inside PHP WASM,
			// mapped to stateDir and docroot by the child process.
			const preflightResult = await runImporterCommandUntilComplete( stateDir, docroot, [
				'preflight',
				apiUrl,
				`--secret=${ secret }`,
				'--no-adaptive',
				'--state-dir=/state',
				'--docroot=/docroot',
			] );

			const envelope = parseImporterJson( preflightResult );
			const preflightData = envelope.data ?? envelope;

			if ( ! preflightData.ok ) {
				throw new LoggerError( preflightData.error || __( 'Remote site preflight check failed.' ) );
			}

			preflight = {
				siteurl: preflightData.database?.wp?.siteurl || undefined,
				wp_version: preflightData.database?.wp?.wp_version || undefined,
				php_version: preflightData.php?.version || undefined,
				table_prefix: preflightData.database?.wp?.table_prefix || undefined,
			};
			fs.writeFileSync( preflightCachePath, JSON.stringify( preflight ) );

			logger.reportSuccess(
				`Connected – WordPress ${ preflight.wp_version || 'unknown' }, ` +
					`PHP ${ preflight.php_version || 'unknown' }`
			);
		}

		const remoteUrl = preflight.siteurl || url;
		const remoteHost = new URL( remoteUrl ).host;

		// ── Step 2: Download files ──────────────────────────────────
		logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading files…' ) );

		await runImporterCommandUntilComplete(
			stateDir,
			docroot,
			[
				'files-sync',
				apiUrl,
				`--secret=${ secret }`,
				'--no-adaptive',
				'--state-dir=/state',
				'--docroot=/docroot',
			],
			( progress ) => logger.reportProgress( progress )
		);

		logger.reportSuccess( __( 'Files downloaded' ) );

		// ── Step 3: Download database ───────────────────────────────
		logger.reportStart( LoggerAction.DOWNLOAD_SQL, __( 'Downloading database…' ) );

		await runImporterCommandUntilComplete(
			stateDir,
			docroot,
			[
				'db-sync',
				apiUrl,
				`--secret=${ secret }`,
				'--sql-output=file',
				'--no-adaptive',
				'--state-dir=/state',
				'--docroot=/docroot',
			],
			( progress ) => logger.reportProgress( progress )
		);

		logger.reportSuccess( __( 'Database downloaded' ) );

		// ── Step 4: Create Studio site from downloaded files ────────
		logger.reportStart( LoggerAction.CREATE_SITE, `Creating site "${ siteName }"…` );

		sitePath = getDefaultSitePath( siteName );
		siteId = crypto.randomUUID();

		if ( ( await pathExists( sitePath ) ) && ! ( await isEmptyDir( sitePath ) ) ) {
			throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
		}

		// Copy bundled WordPress as the base
		const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );
		if ( ! ( await pathExists( bundledWPPath ) ) ) {
			throw new LoggerError( __( 'Bundled WordPress files not found. Please reinstall Studio.' ) );
		}
		fs.mkdirSync( sitePath, { recursive: true } );
		await recursiveCopyDirectory( bundledWPPath, sitePath );

		// Overlay downloaded wp-content onto the fresh site
		const downloadedWpContent = path.join( docroot, 'wp-content' );
		if ( fs.existsSync( downloadedWpContent ) ) {
			await recursiveCopyDirectory( downloadedWpContent, path.join( sitePath, 'wp-content' ) );
		}

		// Install SQLite integration
		await keepSqliteIntegrationUpdated( sitePath );

		logger.reportSuccess( `Site "${ siteName }" created` );

		// ── Step 5: Apply database directly to SQLite ──────────────
		// Allocate the port early so we can rewrite URLs during db-apply.
		const appdata = await readAppdata();
		for ( const site of appdata.sites ) {
			portFinder.addUnavailablePort( site.port );
		}
		const port = await portFinder.getOpenPort();
		const localUrl = `http://localhost:${ port }`;

		logger.reportStart( LoggerAction.IMPORT_SQL, __( 'Importing database…' ) );

		// Create the database directory so db-apply can write
		// the SQLite file to wp-content/database/.ht.sqlite.
		const dbDir = path.join( sitePath, 'wp-content', 'database' );
		fs.mkdirSync( dbDir, { recursive: true } );

		// Use importer.phar's db-apply to convert the MySQL dump
		// directly into a SQLite database and rewrite URLs in one pass.
		// The importer handles base64 decoding and SQL translation internally.
		await runImporterCommandUntilComplete( stateDir, sitePath, [
			'db-apply',
			apiUrl,
			`--secret=${ secret }`,
			'--state-dir=/state',
			'--docroot=/docroot',
			'--target-engine=sqlite',
			'--target-sqlite-path=/docroot/wp-content/database/.ht.sqlite',
			'--rewrite-url',
			`https://${ remoteHost }`,
			localUrl,
			'--rewrite-url',
			`http://${ remoteHost }`,
			localUrl,
		] );

		logger.reportSuccess( __( 'Database imported' ) );

		// ── Step 6: Register site ───────────────────────────────────
		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			port,
			phpVersion: DEFAULT_PHP_VERSION,
			adminPassword: 'password',
			running: false,
			isWpAutoUpdating: true,
			enableHttps: false,
		};

		try {
			await lockAppdata();
			const userData = await readAppdata();
			userData.sites.push( siteDetails );
			sortSites( userData.sites );
			await saveAppdata( userData );
		} finally {
			await unlockAppdata();
		}

		// ── Clean up import state ───────────────────────────────────
		fs.rmSync( importDir, { recursive: true, force: true } );

		// ── Done ────────────────────────────────────────────────────
		siteDetails.url = localUrl;

		console.log( '' );
		console.log( `Site "${ siteName }" imported successfully!` );
		console.log( '' );
		console.log( __( 'Site URL: ' ), localUrl );
		console.log( __( 'WP Admin: ' ), `${ localUrl }/wp-admin/` );
		console.log( `Start the site with: studio site start --path "${ sitePath }"` );
		console.log( '' );

		logger.reportKeyValuePair( 'id', siteDetails.id );

		await emitSiteEvent( SITE_EVENTS.CREATED, { siteId: siteDetails.id } );
	} catch ( error ) {
		// Don't clean up the import directory on failure — it allows
		// the user to re-run the same command to resume.
		console.log( '' );
		console.log( 'To resume this import, re-run the same command:' );
		console.log( `  studio site import --url ${ url } --secret <secret> --name "${ siteName }"` );
		console.log( '' );

		if ( siteId ) {
			try {
				await removeSiteFromAppdata( siteId );
			} catch {
				// Best-effort cleanup
			}
		}
		if ( sitePath && ( await pathExists( sitePath ) ) ) {
			try {
				fs.rmSync( sitePath, { recursive: true, force: true } );
			} catch {
				// Best-effort cleanup
			}
		}

		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to import site' ), error );
	} finally {
		setTimeout( () => process.exit( 0 ), 10 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'import',
		describe: __( 'Import a remote WordPress site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'url', {
					type: 'string',
					describe: __( 'URL of the remote WordPress site' ),
					demandOption: true,
				} )
				.option( 'secret', {
					type: 'string',
					describe: __( 'Shared HMAC secret configured in the migration plugin' ),
					demandOption: true,
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Local site name' ),
					demandOption: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.url as string, argv.secret as string, argv.name as string );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to import site' ), error ) );
				}
			}
		},
	} );
};
