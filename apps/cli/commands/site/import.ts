/**
 * CLI command: studio site import
 *
 * Imports a remote WordPress site into a local Studio site using the
 * streaming site migration protocol. Delegates all protocol work to
 * importer.phar (run via PHP WASM), then sets up the imported files
 * as a Studio site with SQLite and URL rewriting.
 *
 * The import flow:
 *   1. Create the site directory upfront (not yet a Studio site)
 *   2. Preflight – verify the remote plugin is reachable (cached, runs once)
 *   3. files-sync – download all WordPress files directly into the site dir
 *   4. db-sync – download the SQL dump via importer.phar
 *   5. Find the WordPress document root (wp-config.php location)
 *   6. Apply the database dump directly to SQLite via db-apply,
 *      rewriting URLs (http + https variants → localhost) in the same pass
 *   7. Register the site in Studio with the document root as the path
 *
 * Resumption: import state is persisted in the Studio appdata directory,
 * keyed by URL. The site directory is preserved on failure so re-running
 * the same command resumes from where it left off. The importer.phar
 * natively supports resuming partial file and database downloads.
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
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
import { installSqliteIntegration } from 'cli/lib/sqlite-integration';
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

/**
 * Decodes a value from the importer's state JSON. Values may be plain
 * strings or base64-encoded with a "base64:" prefix.
 */
function decodeStateValue( value: string ): string {
	if ( value.startsWith( 'base64:' ) ) {
		return Buffer.from( value.slice( 7 ), 'base64' ).toString( 'utf-8' );
	}
	return value;
}

/**
 * Patches wp-config.php to disable error display. Remote sites may have
 * WP_DEBUG enabled or ini_set('display_errors', '1'). Studio controls
 * these via Blueprint constants at runtime, but errors that occur very
 * early in the PHP bootstrap (before WordPress applies its settings)
 * can still leak through. Injecting @ini_set('display_errors', '0')
 * right after the opening <?php tag catches those early errors.
 */
function disableErrorDisplayInWpConfig( documentRoot: string ): void {
	const wpConfigPath = path.join( documentRoot, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}

	let content = fs.readFileSync( wpConfigPath, 'utf-8' );

	// Inject display_errors = off right after the opening <?php tag
	content = content.replace( /^<\?php\s*/, "<?php\n@ini_set('display_errors', '0');\n" );

	fs.writeFileSync( wpConfigPath, content );
}

/**
 * Parses a PHP serialized array of strings, e.g.:
 *   a:2:{i:0;s:19:"akismet/akismet.php";i:1;s:33:"sg-security/sg-security.php";}
 * Returns the string values as a plain array.
 */
function parsePhpSerializedStringArray( serialized: string ): string[] {
	const items: string[] = [];
	// Match each s:LENGTH:"VALUE"; entry
	const regex = /s:(\d+):"([\s\S]*?)";/g;
	let match;
	while ( ( match = regex.exec( serialized ) ) !== null ) {
		items.push( match[ 2 ] );
	}
	return items;
}

/**
 * Serializes a plain array of strings into PHP serialized format, e.g.:
 *   a:2:{i:0;s:19:"akismet/akismet.php";i:1;s:9:"hello.php";}
 */
function serializePhpStringArray( items: string[] ): string {
	const entries = items.map( ( val, i ) => `i:${ i };s:${ val.length }:"${ val }";` ).join( '' );
	return `a:${ items.length }:{${ entries }}`;
}

/**
 * Deactivates a plugin by editing the active_plugins option directly
 * in the SQLite database. This avoids loading WordPress/PHP which
 * could itself fail due to the problematic plugin.
 */
function deactivatePluginInSqlite(
	dbPath: string,
	tablePrefix: string,
	pluginSlug: string
): boolean {
	const optionName = 'active_plugins';
	const table = `${ tablePrefix }options`;

	// Read the current active_plugins value
	const readResult = spawnSync( 'sqlite3', [
		dbPath,
		`SELECT option_value FROM ${ table } WHERE option_name = '${ optionName }';`,
	] );
	if ( readResult.status !== 0 || ! readResult.stdout ) {
		return false;
	}

	const serialized = readResult.stdout.toString().trim();
	const plugins = parsePhpSerializedStringArray( serialized );
	const filtered = plugins.filter( ( p ) => ! p.startsWith( pluginSlug + '/' ) );

	if ( filtered.length === plugins.length ) {
		// Plugin was not active
		return false;
	}

	const newSerialized = serializePhpStringArray( filtered );
	// Use parameterized update via stdin to avoid shell quoting issues
	// with the serialized PHP string.
	const sql = `UPDATE ${ table } SET option_value = '${ newSerialized.replace(
		/'/g,
		"''"
	) }' WHERE option_name = '${ optionName }';`;
	const writeResult = spawnSync( 'sqlite3', [ dbPath ], { input: sql } );
	return writeResult.status === 0;
}

/**
 * Reads the import state file (.import-state.json) to determine the
 * local WordPress document root. The importer preserves the full
 * remote directory structure within the docroot, so a remote WordPress
 * root at /home/user/site/htdocs becomes sitePath/home/user/site/htdocs
 * locally. We read wp_detect.roots[0].path from the preflight data to
 * find that path.
 */
function getDocumentRootFromState( stateDir: string, sitePath: string ): string {
	const stateFile = path.join( stateDir, '.import-state.json' );
	const state = JSON.parse( fs.readFileSync( stateFile, 'utf-8' ) );

	const wpRootEncoded = state.preflight?.data?.wp_detect?.roots?.[ 0 ]?.path;
	if ( ! wpRootEncoded ) {
		return sitePath;
	}

	const remoteWpRoot = decodeStateValue( wpRootEncoded )
		.replace( /^\/+/, '' )
		.replace( /\/+$/, '' );
	return remoteWpRoot ? path.join( sitePath, remoteWpRoot ) : sitePath;
}

export async function runCommand( url: string, secret: string, name: string ): Promise< void > {
	const apiUrl = url.replace( /\/+$/, '' ) + '/?site-export-api';
	const siteName = name;
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
	fs.mkdirSync( stateDir, { recursive: true } );

	// Create the site directory upfront so files-sync can download
	// directly into it. On resume, the directory already has partial
	// files and the importer picks up where it left off.
	const sitePath = getDefaultSitePath( siteName );

	const isResume = fs.readdirSync( stateDir ).length > 0;

	if ( ! isResume && ( await pathExists( sitePath ) ) && ! ( await isEmptyDir( sitePath ) ) ) {
		throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
	}

	fs.mkdirSync( sitePath, { recursive: true } );

	if ( isResume ) {
		console.log( `Resuming previous import for ${ url }` );
		console.log( '' );
	}

	console.log( `Importing "${ siteName }" from ${ url }` );
	console.log( `Site directory: ${ sitePath }` );
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
			// mapped to stateDir and sitePath by the child process.
			const preflightResult = await runImporterCommandUntilComplete( stateDir, sitePath, [
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
			sitePath,
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
			sitePath,
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

		// ── Step 4: Find document root and set up SQLite ────────────
		// The importer's state file records where WordPress lives on the
		// remote server relative to the document root. Use that to
		// determine the local WordPress root within sitePath.
		const documentRoot = getDocumentRootFromState( stateDir, sitePath );

		logger.reportStart( LoggerAction.CREATE_SITE, `Creating site "${ siteName }"…` );

		siteId = crypto.randomUUID();

		// Install the SQLite integration drop-in. The remote site uses
		// MySQL, so we must unconditionally install db.php and the
		// mu-plugin to redirect WordPress to the SQLite database.
		await installSqliteIntegration( documentRoot );

		// Disable error display in wp-config.php so PHP errors from
		// incompatible plugins don't leak into the browser.
		disableErrorDisplayInWpConfig( documentRoot );

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
		const dbDir = path.join( documentRoot, 'wp-content', 'database' );
		fs.mkdirSync( dbDir, { recursive: true } );

		// Use importer.phar's db-apply to convert the MySQL dump
		// directly into a SQLite database and rewrite URLs in one pass.
		// The importer handles base64 decoding and SQL translation internally.
		await runImporterCommandUntilComplete( stateDir, documentRoot, [
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

		// ── Step 6: Deactivate hosting-specific plugins ─────────────
		// The sg-security plugin (SiteGround Security) logs every visit
		// during WordPress boot, triggering NOT NULL constraint errors
		// in the SQLite translator that prevent the site from starting.
		// Deactivate it directly in the SQLite database to avoid loading
		// WordPress/PHP, which could itself fail due to the plugin.
		const sqliteDbPath = path.join( documentRoot, 'wp-content', 'database', '.ht.sqlite' );
		const tablePrefix = preflight.table_prefix || 'wp_';
		if ( deactivatePluginInSqlite( sqliteDbPath, tablePrefix, 'sg-security' ) ) {
			logger.reportSuccess( 'Deactivated sg-security plugin' );
		}
		if ( deactivatePluginInSqlite( sqliteDbPath, tablePrefix, 'sg-cachepress' ) ) {
			logger.reportSuccess( 'Deactivated sg-cachepress plugin' );
		}

		// ── Step 7: Register site ───────────────────────────────────
		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: documentRoot,
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
		console.log( `Start the site with: studio site start --path "${ documentRoot }"` );
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
