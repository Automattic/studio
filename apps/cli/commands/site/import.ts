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
import chalk from 'chalk';
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

const PLUGIN_INSTALL_HINT =
	'Make sure the streaming-site-migration plugin is installed and activated.\n' +
	'Download the latest version from:\n' +
	'https://github.com/adamziel/streaming-site-migration/releases/latest';

/**
 * Draws a red-bordered box around a message for terminal display.
 */
function redBox( message: string ): string {
	const lines = message.split( '\n' );
	const maxLen = Math.max( ...lines.map( ( l ) => l.length ) );
	const top = chalk.red( '┌' + '─'.repeat( maxLen + 2 ) + '┐' );
	const bottom = chalk.red( '└' + '─'.repeat( maxLen + 2 ) + '┘' );
	const body = lines
		.map( ( line ) => chalk.red( '│' ) + ' ' + line.padEnd( maxLen ) + ' ' + chalk.red( '│' ) )
		.join( '\n' );
	return `${ top }\n${ body }\n${ bottom }`;
}

/**
 * An import error that separates the user-facing message from
 * technical details. The handler shows the details only when
 * --verbose is set.
 */
class ImportError extends LoggerError {
	technicalDetails: string;

	constructor( userMessage: string, technicalDetails: string ) {
		super( userMessage );
		this.technicalDetails = technicalDetails;
	}
}

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
 * Ensures wp-config.php has all required constants for running
 * under Studio with SQLite.
 *
 * Managed WordPress hosts like SiteGround and WordPress.com Atomic
 * inject DB credentials at the server level, so wp-config.php
 * may only contain comments about DB_HOST/DB_USER/DB_PASSWORD
 * without actually defining them. WordPress requires these
 * constants to exist (even with SQLite, where db.php intercepts
 * before MySQL connects) or it redirects to setup-config.php.
 *
 * WP_CONTENT_DIR is set explicitly because Atomic sites use
 * symlinks for wp-load.php that make __DIR__ resolve to the
 * shared WP core directory. Without this, WordPress would look
 * for wp-content (and db.php) in the core dir instead of the
 * site's document root — exactly what the Atomic platform does
 * with `define( 'WP_CONTENT_DIR', realpath('/srv/htdocs/wp-content') )`.
 */
function ensureRequiredConstantsInWpConfig( documentRoot: string ): void {
	const wpConfigPath = path.join( documentRoot, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}

	let content = fs.readFileSync( wpConfigPath, 'utf-8' );

	// DB placeholder constants — values don't matter for SQLite,
	// but WordPress requires them to be defined.
	const requiredConstants: Record< string, string > = {
		DB_NAME: 'wordpress',
		DB_USER: 'root',
		DB_PASSWORD: 'root',
		DB_HOST: 'localhost',
	};

	for ( const [ name, value ] of Object.entries( requiredConstants ) ) {
		const definePattern = new RegExp( `define\\s*\\(\\s*['"]${ name }['"]` );
		if ( ! definePattern.test( content ) ) {
			// Insert before "That's all, stop editing" or before ABSPATH
			const insertBefore = content.match(
				/\/\*.*(?:stop editing|ABSPATH).*\*\/|if\s*\(\s*!\s*defined\s*\(\s*'ABSPATH'\s*\)/
			);
			const insertLine = `define( '${ name }', '${ value }' );\n`;
			if ( insertBefore ) {
				content = content.replace( insertBefore[ 0 ], insertLine + insertBefore[ 0 ] );
			} else {
				content = content.replace( /(require_once.*wp-settings\.php)/, insertLine + '$1' );
			}
		}
	}

	// WP_CONTENT_DIR must point to the document root's wp-content,
	// not wherever __DIR__ resolves to (which may be a symlink target).
	// Using __DIR__ here works because wp-config.php is a real file
	// in the document root (or a symlink that resolves back to it).
	if ( ! /define\s*\(\s*['"]WP_CONTENT_DIR['"]/.test( content ) ) {
		const insertBefore = content.match(
			/\/\*.*(?:stop editing|ABSPATH).*\*\/|if\s*\(\s*!\s*defined\s*\(\s*'ABSPATH'\s*\)/
		);
		const insertLine = `define( 'WP_CONTENT_DIR', __DIR__ . '/wp-content' );\n`;
		if ( insertBefore ) {
			content = content.replace( insertBefore[ 0 ], insertLine + insertBefore[ 0 ] );
		} else {
			content = content.replace( /(require_once.*wp-settings\.php)/, insertLine + '$1' );
		}
	}

	fs.writeFileSync( wpConfigPath, content );
}

/**
 * Detects WordPress.com Atomic site structure and creates a
 * wp-config.php symlink in the WordPress core directory.
 *
 * Atomic sites use symlinks to share a single WordPress core install:
 *   htdocs/__wp__ → ../wordpress/core/latest → 6.9.4/
 *   htdocs/wp-load.php → __wp__/wp-load.php
 *
 * When PHP resolves __DIR__ inside the symlinked wp-load.php, it gets
 * the core directory (e.g. wordpress/core/6.9.4/), not htdocs/.
 * WordPress then looks for wp-config.php in __DIR__ — the core
 * directory — and fails because wp-config.php lives in htdocs/.
 *
 * On the actual Atomic platform this works because their preload
 * scripts run before wp-load.php. For Playground we solve it by
 * placing a wp-config.php symlink in the core directory that points
 * back to the document root's wp-config.php.
 */
function createAtomicWpConfigSymlink( sitePath: string, documentRoot: string ): boolean {
	const wpSymlinkPath = path.join( documentRoot, '__wp__' );
	const wpLoadPath = path.join( documentRoot, 'wp-load.php' );

	// Check for the Atomic structure: __wp__ symlink and wp-load.php symlink
	let wpLoadStat;
	try {
		wpLoadStat = fs.lstatSync( wpLoadPath );
	} catch {
		return false;
	}

	if ( ! wpLoadStat.isSymbolicLink() || ! fs.existsSync( wpSymlinkPath ) ) {
		return false;
	}

	let wpLoadLinkTarget;
	try {
		wpLoadLinkTarget = fs.readlinkSync( wpLoadPath );
	} catch {
		return false;
	}

	// Verify wp-load.php points through __wp__
	if ( ! wpLoadLinkTarget.startsWith( '__wp__/' ) ) {
		return false;
	}

	// Resolve the real directory where wp-load.php lives.
	// This follows all symlinks to get the actual filesystem path.
	const realWpLoadPath = fs.realpathSync( wpLoadPath );
	const wpCoreDir = path.dirname( realWpLoadPath );

	// Don't overwrite an existing wp-config.php in the core directory
	const coreWpConfigPath = path.join( wpCoreDir, 'wp-config.php' );
	if ( fs.existsSync( coreWpConfigPath ) ) {
		return true;
	}

	// Compute a relative symlink path from the core directory back to
	// the document root's wp-config.php
	const wpConfigRealPath = path.join( documentRoot, 'wp-config.php' );
	const relativePath = path.relative( wpCoreDir, wpConfigRealPath );

	fs.symlinkSync( relativePath, coreWpConfigPath );
	return true;
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
			let preflightResult: ImporterResult;
			try {
				preflightResult = await runImporterCommandUntilComplete( stateDir, sitePath, [
					'preflight',
					apiUrl,
					`--secret=${ secret }`,
					'--no-adaptive',
					'--state-dir=/state',
					'--docroot=/docroot',
				] );
			} catch ( preflightError ) {
				const details =
					preflightError instanceof Error ? preflightError.message : String( preflightError );
				throw new ImportError(
					__( 'Could not connect to the remote site.' ) + '\n\n' + PLUGIN_INSTALL_HINT,
					details
				);
			}

			let envelope;
			try {
				envelope = parseImporterJson( preflightResult );
			} catch {
				throw new ImportError(
					__( 'The remote site did not respond with a recognized format.' ) +
						'\n\n' +
						PLUGIN_INSTALL_HINT,
					`stdout: ${ preflightResult.stdout }\nstderr: ${ preflightResult.stderr }`
				);
			}
			const preflightData = envelope.data ?? envelope;

			if ( ! preflightData.ok ) {
				const errorDetail = preflightData.error || '';
				// The importer returns "Invalid JSON: ..." when the remote
				// site responds with HTML instead of the expected API JSON.
				// This typically means the export plugin isn't installed.
				const isJsonParseError = /^Invalid JSON\b/i.test( errorDetail );
				const userMessage = isJsonParseError
					? __( 'The remote site responded with HTML instead of the expected export API.' )
					: __( 'Remote site preflight check failed.' );

				throw new ImportError(
					userMessage + '\n\n' + PLUGIN_INSTALL_HINT,
					preflightResult.stdout.trim() + '\n' + preflightResult.stderr.trim()
				);
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

		// Ensure DB constants are defined in wp-config.php. Managed
		// hosts inject these at the server level, so the imported
		// wp-config.php may not define them. WordPress requires all
		// four even with SQLite (db.php intercepts before MySQL
		// connects, but the constants must exist).
		ensureRequiredConstantsInWpConfig( documentRoot );

		// WordPress.com Atomic sites use symlinks to share a single
		// WP core install. wp-load.php symlinks into the core dir,
		// and PHP's __DIR__ resolves to there — so WordPress looks
		// for wp-config.php in the core dir instead of the document
		// root. Create a wp-config.php symlink in the core dir
		// pointing back to the document root's wp-config.php.
		if ( createAtomicWpConfigSymlink( sitePath, documentRoot ) ) {
			logger.reportSuccess( 'Configured WordPress.com Atomic symlinks' );
		}

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
				} )
				.option( 'verbose', {
					type: 'boolean',
					describe: __( 'Show detailed error information' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const verbose = argv.verbose as boolean;
			try {
				await runCommand( argv.url as string, argv.secret as string, argv.name as string );
			} catch ( error ) {
				if ( error instanceof ImportError ) {
					logger.spinner.fail( __( 'Import failed' ) );
					console.error( '\n' + redBox( error.message ) );
					if ( verbose && error.technicalDetails ) {
						console.error( '\n' + chalk.dim( error.technicalDetails ) );
					} else if ( error.technicalDetails ) {
						console.error( chalk.dim( '\nRun with --verbose for detailed error output.' ) );
					}
				} else if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to import site' ), error ) );
				}
			}
		},
	} );
};
