import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	DATABASE_ENGINE_MYSQL,
	DATABASE_ENGINE_SQLITE,
	getSiteDatabaseEngine,
	isMysqlSite,
	type DatabaseEngine,
	type MysqlSiteConfig,
} from '@studio/common/lib/database-engine';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import { portFinder } from '@studio/common/lib/port-finder';
import { SITE_RUNTIME_NATIVE_PHP, getSiteRuntime } from '@studio/common/lib/site-runtime';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getWpConfigTransformerPath } from 'cli/lib/dependency-management/paths';
import { exportDatabaseToFile } from 'cli/lib/import-export/export/export-database';
import {
	canConnectToMysql,
	ensureMysqlServerRunning,
	importSqlFileIntoMysql,
	type ManagedMysqlServer,
} from 'cli/lib/mysql/mysql-process';
import {
	createMysqlSiteConfig,
	provisionMysqlDatabase,
	removeSqliteIntegrationForMysql,
} from 'cli/lib/mysql/mysql-site';
import { ensureWpConfig, isWordPressInstalled } from 'cli/lib/native-php/site-setup';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

// The export driver emits per-table `COLLATE=utf8mb4_0900_ai_ci`. Provision the
// database with the same collation so the schema default and imported tables
// agree instead of silently diverging (see mysql-support design notes).
const CONVERT_DATABASE_COLLATION = 'utf8mb4_0900_ai_ci';

type ConvertBackup = {
	dir: string;
	dbPhpPath?: string;
	sqliteMuPluginDir?: string;
	wpConfigPath?: string;
	priorSite: SiteData;
};

export async function runCommand( sitePath: string, to: DatabaseEngine ): Promise< void > {
	if ( to !== DATABASE_ENGINE_MYSQL ) {
		throw new LoggerError(
			sprintf( __( 'Unsupported conversion target "%s". Only "mysql" is supported.' ), to )
		);
	}

	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		// Preflight validation ---------------------------------------------------
		if ( isMysqlSite( site ) ) {
			throw new LoggerError( __( 'This site already uses MySQL. Nothing to convert.' ) );
		}
		if ( getSiteRuntime( site ) !== SITE_RUNTIME_NATIVE_PHP ) {
			throw new LoggerError(
				__( 'MySQL requires the native PHP runtime. Use "studio set --runtime native" first.' )
			);
		}
		const dbPhpPath = path.join( site.path, 'wp-content', 'db.php' );
		if ( fs.existsSync( dbPhpPath ) ) {
			const dropinContent = await fs.promises.readFile( dbPhpPath, 'utf8' );
			if ( dropinContent.includes( '@studio-keep' ) ) {
				throw new LoggerError(
					__( 'Cannot convert while wp-content/db.php is marked @studio-keep.' )
				);
			}
			if (
				! dropinContent.includes( 'sqlite-database-integration' ) &&
				! dropinContent.includes( 'SQLITE_DB_DROPIN_VERSION' )
			) {
				throw new LoggerError( __( 'Cannot convert with an unknown wp-content/db.php drop-in.' ) );
			}
		}

		const phpVersion = resolveNativePhpVersion( site.phpVersion ?? '' );

		// The convert flow provisions and boots MySQL directly (outside the site
		// server process), so the site must not be running under SQLite while we
		// swap its drop-in and config out from under it.
		const wasRunning = Boolean( await isServerRunning( site.id ) );
		if ( wasRunning ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
		}

		// Step 0 — backup --------------------------------------------------------
		logger.reportStart( LoggerAction.CREATE_BACKUP, __( 'Backing up SQLite site…' ) );
		const backup = await createBackup( site );
		logger.reportSuccess( sprintf( __( 'Backup created at %s' ), backup.dir ) );

		let mysqlServer: ManagedMysqlServer | null = null;
		let mysqlConfig: MysqlSiteConfig | undefined;
		let swappedConfig = false;

		try {
			// Step 1 — export portable MySQL SQL from the SQLite site --------------
			logger.reportStart( LoggerAction.EXPORT_DATABASE, __( 'Exporting database to MySQL SQL…' ) );
			const dumpPath = path.join( backup.dir, `${ generateBackupFilename( 'convert-db' ) }.sql` );
			await exportDatabaseToFile( site, dumpPath );
			const dumpBytes = fs.statSync( dumpPath ).size;
			logger.reportSuccess(
				sprintf( __( 'Database exported (%s bytes)' ), dumpBytes.toLocaleString() )
			);

			// Step 2 — provision MySQL --------------------------------------------
			logger.reportStart( LoggerAction.SAVE_SITE, __( 'Provisioning MySQL database…' ) );
			// Reserve every port already claimed by a site (its WordPress server
			// port, and any existing MySQL port) so the MySQL port we allocate here
			// can't collide with this site's own server port or another site.
			const cliConfigForPorts = await readCliConfig();
			for ( const existing of cliConfigForPorts.sites ) {
				portFinder.addUnavailablePort( existing.port );
				if ( existing.mysql ) {
					portFinder.addUnavailablePort( existing.mysql.port );
				}
			}
			mysqlConfig = createMysqlSiteConfig( site.id, await portFinder.getOpenPort() );
			mysqlServer = await ensureMysqlServerRunning( mysqlConfig, ( message ) =>
				logger.reportProgress( String( message ) )
			);
			await provisionMysqlDatabase( mysqlConfig, { collation: CONVERT_DATABASE_COLLATION } );
			logger.reportSuccess( __( 'MySQL database provisioned' ) );

			// Step 3 — import the dump INTO MySQL ---------------------------------
			logger.reportStart( LoggerAction.IMPORT_DATABASE, __( 'Importing data into MySQL…' ) );
			await importSqlFileIntoMysql( mysqlConfig, dumpPath );
			logger.reportSuccess( __( 'Data imported into MySQL' ) );

			// Step 4 — swap config to MySQL ---------------------------------------
			logger.reportStart( LoggerAction.SAVE_SITE, __( 'Switching site to MySQL…' ) );
			await removeSqliteIntegrationForMysql( site.path );
			swappedConfig = true;
			await ensureWpConfig(
				site.path,
				phpVersion,
				new AbortController().signal,
				getWpConfigTransformerPath(),
				{
					databaseEngine: DATABASE_ENGINE_MYSQL,
					mysql: mysqlConfig,
					enableDebugLog: site.enableDebugLog,
					enableDebugDisplay: site.enableDebugDisplay,
				}
			);
			logger.reportSuccess( __( 'Site configuration switched to MySQL' ) );

			// Step 5 — verify boot on MySQL (hard accept gate) --------------------
			logger.reportStart( LoggerAction.VALIDATE, __( 'Verifying WordPress boots on MySQL…' ) );
			// Confirm mysqld is actually accepting connections before booting PHP
			// against it, so a transient not-yet-ready socket doesn't read as a
			// failed conversion.
			if ( ! ( await waitForMysqlReachable( mysqlConfig ) ) ) {
				throw new Error( 'MySQL server was not reachable before the boot check.' );
			}
			const installed = await verifyWordPressBoots( site.path, phpVersion );
			if ( ! installed ) {
				throw new Error(
					'WordPress did not report as installed against MySQL (is_blog_installed() was false).'
				);
			}
			logger.reportSuccess( __( 'WordPress boots on MySQL' ) );

			// Step 6 — commit config flip -----------------------------------------
			logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site configuration…' ) );
			await commitConfigFlip( site.id, mysqlConfig );
			logger.reportSuccess( __( 'Site configuration saved' ) );
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Conversion failed — rolling back to SQLite…' ), error ),
				false
			);
			await rollback( backup, mysqlConfig, swappedConfig, mysqlServer, phpVersion );
			throw new LoggerError(
				__( 'Conversion failed and the site was rolled back to SQLite. The site is unchanged.' ),
				error
			);
		} finally {
			await mysqlServer?.stop().catch( () => undefined );
		}

		console.log( '' );
		console.log(
			sprintf(
				__(
					'Site "%s" was converted to MySQL. Run "studio start" to serve it on the MySQL stack.'
				),
				site.name
			)
		);
		console.log( sprintf( __( 'SQLite backup retained at: %s' ), backup.dir ) );
	} finally {
		await disconnectFromDaemon();
	}
}

async function createBackup( site: SiteData ): Promise< ConvertBackup > {
	const dir = path.join( os.tmpdir(), `studio-convert-backup-${ site.id }-${ Date.now() }` );
	await fs.promises.mkdir( dir, { recursive: true } );

	const backup: ConvertBackup = { dir, priorSite: structuredClone( site ) };

	const dbPhpPath = path.join( site.path, 'wp-content', 'db.php' );
	if ( fs.existsSync( dbPhpPath ) ) {
		backup.dbPhpPath = path.join( dir, 'db.php' );
		await fs.promises.copyFile( dbPhpPath, backup.dbPhpPath );
	}

	const sqliteMuPluginDir = path.join(
		site.path,
		'wp-content',
		'mu-plugins',
		'sqlite-database-integration'
	);
	if ( fs.existsSync( sqliteMuPluginDir ) ) {
		backup.sqliteMuPluginDir = path.join( dir, 'sqlite-database-integration' );
		await fs.promises.cp( sqliteMuPluginDir, backup.sqliteMuPluginDir, { recursive: true } );
	}

	const wpConfigPath = path.join( site.path, 'wp-config.php' );
	if ( fs.existsSync( wpConfigPath ) ) {
		backup.wpConfigPath = path.join( dir, 'wp-config.php' );
		await fs.promises.copyFile( wpConfigPath, backup.wpConfigPath );
	}

	// Record the prior config so rollback can restore engine + mysql fields.
	await fs.promises.writeFile(
		path.join( dir, 'prior-site.json' ),
		JSON.stringify( backup.priorSite, null, 2 ) + '\n',
		'utf8'
	);

	return backup;
}

async function waitForMysqlReachable( mysqlConfig: MysqlSiteConfig ): Promise< boolean > {
	const deadline = Date.now() + 30_000;
	while ( Date.now() < deadline ) {
		if ( await canConnectToMysql( mysqlConfig ) ) {
			return true;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
	}
	return false;
}

async function verifyWordPressBoots(
	sitePath: string,
	phpVersion: ReturnType< typeof resolveNativePhpVersion >
): Promise< boolean > {
	// The check spawns a fresh PHP process; give it a couple of attempts so a
	// single transient first-connection hiccup doesn't fail an otherwise-good
	// conversion. A thrown error on the final attempt is surfaced to the caller.
	let lastError: unknown;
	for ( let attempt = 0; attempt < 3; attempt++ ) {
		try {
			if ( await isWordPressInstalled( sitePath, phpVersion, new AbortController().signal ) ) {
				return true;
			}
			lastError = undefined;
		} catch ( error ) {
			lastError = error;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
	}
	if ( lastError ) {
		throw lastError;
	}
	return false;
}

async function commitConfigFlip( siteId: string, mysqlConfig: MysqlSiteConfig ): Promise< void > {
	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const target = cliConfig.sites.find( ( s ) => s.id === siteId );
		if ( ! target ) {
			throw new Error( `Site ${ siteId } no longer present in config during commit.` );
		}
		target.databaseEngine = DATABASE_ENGINE_MYSQL;
		target.mysql = mysqlConfig;
		await saveCliConfig( cliConfig );
	} finally {
		await unlockCliConfig();
	}
}

async function rollback(
	backup: ConvertBackup,
	mysqlConfig: MysqlSiteConfig | undefined,
	swappedConfig: boolean,
	mysqlServer: ManagedMysqlServer | null,
	phpVersion: ReturnType< typeof resolveNativePhpVersion >
): Promise< void > {
	const sitePath = backup.priorSite.path;

	// Restore the SQLite drop-in + mu-plugin + wp-config if we swapped them.
	if ( swappedConfig ) {
		try {
			if ( backup.dbPhpPath ) {
				await fs.promises.copyFile(
					backup.dbPhpPath,
					path.join( sitePath, 'wp-content', 'db.php' )
				);
			}
			if ( backup.sqliteMuPluginDir ) {
				const dest = path.join(
					sitePath,
					'wp-content',
					'mu-plugins',
					'sqlite-database-integration'
				);
				await fs.promises.rm( dest, { recursive: true, force: true } );
				await fs.promises.cp( backup.sqliteMuPluginDir, dest, { recursive: true } );
			}
			if ( backup.wpConfigPath ) {
				await fs.promises.copyFile( backup.wpConfigPath, path.join( sitePath, 'wp-config.php' ) );
			}
		} catch ( error ) {
			logger.reportError(
				new LoggerError(
					sprintf(
						__( 'Failed to restore SQLite drop-in during rollback. Manual backup: %s' ),
						backup.dir
					),
					error
				),
				false
			);
		}
	}

	// Ensure config still reflects SQLite (never left flipped to MySQL).
	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const target = cliConfig.sites.find( ( s ) => s.id === backup.priorSite.id );
		if ( target ) {
			target.databaseEngine =
				getSiteDatabaseEngine( backup.priorSite ) === DATABASE_ENGINE_MYSQL
					? DATABASE_ENGINE_MYSQL
					: DATABASE_ENGINE_SQLITE;
			// A previously-SQLite site should carry no engine/mysql metadata.
			if ( target.databaseEngine === DATABASE_ENGINE_SQLITE ) {
				target.databaseEngine = backup.priorSite.databaseEngine;
				target.mysql = backup.priorSite.mysql;
			}
			await saveCliConfig( cliConfig );
		}
	} finally {
		await unlockCliConfig();
	}

	// Tear down the half-populated MySQL database + datadir.
	if ( mysqlConfig ) {
		await mysqlServer?.stop().catch( () => undefined );
		try {
			await fs.promises.rm( mysqlConfig.dataDir, { recursive: true, force: true } );
		} catch {
			// dataDir may not have been created; ignore.
		}
	}

	void phpVersion;
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'convert',
		describe: __( 'Convert an existing site to a different database engine' ),
		builder: ( yargs ) => {
			return yargs.option( 'to', {
				type: 'string',
				describe: __( 'Target database engine' ),
				choices: [ DATABASE_ENGINE_MYSQL ] as const,
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.to as DatabaseEngine );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to convert site' ), error );
					logger.reportError( loggerError );
				}
				process.exit( 1 );
			}
		},
	} );
};
