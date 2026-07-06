import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATABASE_ENGINE_MYSQL, DATABASE_ENGINE_SQLITE } from '@studio/common/lib/database-engine';
import { encodePassword } from '@studio/common/lib/passwords';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testing, runCommand } from '../convert';
import type { MysqlSiteConfig } from '@studio/common/lib/database-engine';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { ProcessDescription } from 'cli/lib/types/process-manager-ipc';

const mocks = vi.hoisted( () => ( {
	cliConfig: { version: 1, sites: [] as SiteData[], snapshots: [] },
	lockCliConfig: vi.fn( async () => undefined ),
	readCliConfig: vi.fn(),
	saveCliConfig: vi.fn(),
	unlockCliConfig: vi.fn( async () => undefined ),
	getSiteByFolder: vi.fn(),
	updateSiteLatestCliPid: vi.fn( async () => undefined ),
	connectToDaemon: vi.fn( async () => undefined ),
	disconnectFromDaemon: vi.fn( async () => undefined ),
	getDatabaseProvider: vi.fn(),
	exportDatabaseToFile: vi.fn(),
	importDatabaseFromFile: vi.fn( async () => undefined ),
	ensureMysqlServerRunning: vi.fn(),
	importSqlFileIntoMysql: vi.fn( async () => undefined ),
	canConnectToMysql: vi.fn( async () => true ),
	createMysqlSiteConfig: vi.fn(),
	provisionMysqlDatabase: vi.fn( async () => undefined ),
	removeSqliteIntegrationForMysql: vi.fn(),
	ensureWpConfig: vi.fn(),
	isWordPressInstalled: vi.fn( async () => true ),
	installSqliteIntegration: vi.fn(),
	isServerRunning: vi.fn(),
	startWordPressServer: vi.fn(),
	stopWordPressServer: vi.fn( async () => undefined ),
	getOpenPort: vi.fn( async () => 33306 ),
	addUnavailablePort: vi.fn(),
	stopMysqlServer: vi.fn( async () => undefined ),
} ) );

vi.mock( '@studio/common/lib/php-binary-metadata', () => ( {
	resolveNativePhpVersion: vi.fn( () => '8.4' ),
} ) );

vi.mock( 'cli/lib/cli-config/core', () => ( {
	lockCliConfig: mocks.lockCliConfig,
	readCliConfig: mocks.readCliConfig,
	saveCliConfig: mocks.saveCliConfig,
	unlockCliConfig: mocks.unlockCliConfig,
} ) );

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: mocks.getSiteByFolder,
	updateSiteLatestCliPid: mocks.updateSiteLatestCliPid,
} ) );

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: mocks.connectToDaemon,
	disconnectFromDaemon: mocks.disconnectFromDaemon,
} ) );

vi.mock( 'cli/lib/database/providers', () => ( {
	getDatabaseProvider: mocks.getDatabaseProvider,
} ) );

vi.mock( 'cli/lib/import-export/export/export-database', () => ( {
	exportDatabaseToFile: mocks.exportDatabaseToFile,
	importDatabaseFromFile: mocks.importDatabaseFromFile,
} ) );

vi.mock( 'cli/lib/mysql/mysql-process', () => ( {
	canConnectToMysql: mocks.canConnectToMysql,
	ensureMysqlServerRunning: mocks.ensureMysqlServerRunning,
	importSqlFileIntoMysql: mocks.importSqlFileIntoMysql,
} ) );

vi.mock( 'cli/lib/mysql/mysql-site', () => ( {
	createMysqlSiteConfig: mocks.createMysqlSiteConfig,
	provisionMysqlDatabase: mocks.provisionMysqlDatabase,
	removeSqliteIntegrationForMysql: mocks.removeSqliteIntegrationForMysql,
} ) );

vi.mock( 'cli/lib/native-php/site-setup', () => ( {
	ensureWpConfig: mocks.ensureWpConfig,
	isWordPressInstalled: mocks.isWordPressInstalled,
} ) );

vi.mock( 'cli/lib/sqlite-integration', () => ( {
	installSqliteIntegration: mocks.installSqliteIntegration,
} ) );

vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: mocks.isServerRunning,
	startWordPressServer: mocks.startWordPressServer,
	stopWordPressServer: mocks.stopWordPressServer,
} ) );

vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		addUnavailablePort: mocks.addUnavailablePort,
		getOpenPort: mocks.getOpenPort,
	},
} ) );

vi.mock( '@studio/common/lib/generate-backup-filename', () => ( {
	generateBackupFilename: () => 'convert-db-test',
} ) );

const PHP_VERSION = '8.4' as Parameters< typeof __testing.convertSqliteToMysql >[ 2 ];

function mysqlConfig( overrides: Partial< MysqlSiteConfig > = {} ): MysqlSiteConfig {
	return {
		host: '127.0.0.1',
		port: 33306,
		databaseName: 'studio_test',
		username: 'studio_test',
		password: encodePassword( 'password' ),
		serverVersion: '8.4.10',
		dataDir: path.join( os.tmpdir(), 'studio-convert-test-mysql' ),
		...overrides,
	};
}

function siteData( sitePath: string, overrides: Partial< SiteData > = {} ): SiteData {
	return {
		id: 'site-id',
		name: 'Convert Test',
		path: sitePath,
		port: 8881,
		running: false,
		phpVersion: '8.4',
		runtime: SITE_RUNTIME_NATIVE_PHP,
		...overrides,
	};
}

function writeSqliteIntegration( sitePath: string ): void {
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ), {
		recursive: true,
	} );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), 'sqlite drop-in', 'utf8' );
	fs.writeFileSync(
		path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ),
		'sqlite database',
		'utf8'
	);
	fs.writeFileSync(
		path.join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration', 'load.php' ),
		'sqlite mu-plugin',
		'utf8'
	);
	fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), 'sqlite config', 'utf8' );
}

describe( 'site convert internals', () => {
	const processDescription: ProcessDescription = {
		name: 'studio-site-site-id',
		pmId: 1,
		pid: 12345,
		status: 'online',
		runtime: SITE_RUNTIME_NATIVE_PHP,
	};

	let tmpDir: string;
	let sitePath: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-convert-test-' ) );
		sitePath = path.join( tmpDir, 'site' );
		fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );

		mocks.cliConfig = { version: 1, sites: [], snapshots: [] };
		mocks.readCliConfig.mockImplementation( async () => structuredClone( mocks.cliConfig ) );
		mocks.saveCliConfig.mockImplementation( async ( nextConfig ) => {
			mocks.cliConfig = structuredClone( nextConfig );
		} );
		mocks.getSiteByFolder.mockImplementation( async () =>
			structuredClone( mocks.cliConfig.sites[ 0 ] )
		);
		mocks.getDatabaseProvider.mockReturnValue( { preflight: vi.fn() } );
		mocks.exportDatabaseToFile.mockImplementation( async ( _site, dumpPath: string ) => {
			fs.writeFileSync( dumpPath, 'SQL DUMP', 'utf8' );
		} );
		mocks.importDatabaseFromFile.mockResolvedValue( undefined );
		mocks.ensureMysqlServerRunning.mockResolvedValue( { stop: mocks.stopMysqlServer } );
		mocks.importSqlFileIntoMysql.mockResolvedValue( undefined );
		mocks.canConnectToMysql.mockResolvedValue( true );
		mocks.createMysqlSiteConfig.mockReturnValue( mysqlConfig() );
		mocks.provisionMysqlDatabase.mockResolvedValue( undefined );
		mocks.isWordPressInstalled.mockResolvedValue( true );
		mocks.isServerRunning.mockResolvedValue( undefined );
		mocks.startWordPressServer.mockResolvedValue( processDescription );
		mocks.stopWordPressServer.mockResolvedValue( undefined );
		mocks.updateSiteLatestCliPid.mockResolvedValue( undefined );
		mocks.disconnectFromDaemon.mockResolvedValue( undefined );
		mocks.removeSqliteIntegrationForMysql.mockImplementation( async ( targetSitePath: string ) => {
			await fs.promises.rm( path.join( targetSitePath, 'wp-content', 'db.php' ), { force: true } );
			await fs.promises.rm(
				path.join( targetSitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ),
				{ recursive: true, force: true }
			);
		} );
		mocks.installSqliteIntegration.mockImplementation( async ( targetSitePath: string ) => {
			fs.mkdirSync(
				path.join( targetSitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ),
				{ recursive: true }
			);
			fs.writeFileSync( path.join( targetSitePath, 'wp-content', 'db.php' ), 'new sqlite', 'utf8' );
		} );
		mocks.ensureWpConfig.mockImplementation(
			async ( targetSitePath: string, _php, _signal, _tool, config ) => {
				fs.writeFileSync(
					path.join( targetSitePath, 'wp-config.php' ),
					`${ config?.databaseEngine ?? 'default' } config`,
					'utf8'
				);
			}
		);
	} );

	afterEach( () => {
		vi.clearAllMocks();
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'rollback restores the prior databaseEngine and mysql fields', async () => {
		const priorMysql = mysqlConfig( { databaseName: 'prior_database' } );
		const priorSite = siteData( sitePath, {
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: priorMysql,
		} );
		mocks.cliConfig.sites = [ siteData( sitePath, { databaseEngine: DATABASE_ENGINE_SQLITE } ) ];

		const backup = await __testing.createBackup( priorSite );
		await __testing.rollbackToPriorSite( backup, undefined, false, null );

		expect( mocks.cliConfig.sites[ 0 ] ).toMatchObject( {
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: priorMysql,
		} );
	} );

	it( 'rollback restores backed up SQLite drop-in, database, mu-plugin, and wp-config files', async () => {
		writeSqliteIntegration( sitePath );
		const priorSite = siteData( sitePath );
		mocks.cliConfig.sites = [ { ...priorSite, databaseEngine: DATABASE_ENGINE_MYSQL } ];

		const backup = await __testing.createBackup( priorSite );
		fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), 'mysql drop-in', 'utf8' );
		fs.rmSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true, force: true } );
		fs.rmSync( path.join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ), {
			recursive: true,
			force: true,
		} );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), 'mysql config', 'utf8' );

		await __testing.rollbackToPriorSite( backup, undefined, true, null );

		expect( fs.readFileSync( path.join( sitePath, 'wp-content', 'db.php' ), 'utf8' ) ).toBe(
			'sqlite drop-in'
		);
		expect(
			fs.readFileSync( path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), 'utf8' )
		).toBe( 'sqlite database' );
		expect(
			fs.readFileSync(
				path.join(
					sitePath,
					'wp-content',
					'mu-plugins',
					'sqlite-database-integration',
					'load.php'
				),
				'utf8'
			)
		).toBe( 'sqlite mu-plugin' );
		expect( fs.readFileSync( path.join( sitePath, 'wp-config.php' ), 'utf8' ) ).toBe(
			'sqlite config'
		);
	} );

	it( 'rollback removes SQLite drop-in and mu-plugin paths when they were absent before conversion', async () => {
		const priorSite = siteData( sitePath, {
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: mysqlConfig(),
		} );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), 'mysql config', 'utf8' );
		const backup = await __testing.createBackup( priorSite );

		writeSqliteIntegration( sitePath );
		await __testing.rollbackToPriorSite( backup, undefined, true, null );

		expect( fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) ) ).toBe( false );
		expect(
			fs.existsSync(
				path.join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' )
			)
		).toBe( false );
		expect( fs.readFileSync( path.join( sitePath, 'wp-config.php' ), 'utf8' ) ).toBe(
			'mysql config'
		);
	} );

	it( 'restores site config and files after sqlite to mysql fails after the config swap', async () => {
		writeSqliteIntegration( sitePath );
		const site = siteData( sitePath );
		mocks.cliConfig.sites = [
			{ ...site, databaseEngine: DATABASE_ENGINE_MYSQL, mysql: mysqlConfig() },
		];
		mocks.isWordPressInstalled.mockResolvedValue( false );

		const backup = await __testing.createBackup( site );

		await expect( __testing.convertSqliteToMysql( site, backup, PHP_VERSION ) ).rejects.toThrow(
			'rolled back to SQLite'
		);

		expect( fs.readFileSync( path.join( sitePath, 'wp-content', 'db.php' ), 'utf8' ) ).toBe(
			'sqlite drop-in'
		);
		expect(
			fs.readFileSync(
				path.join(
					sitePath,
					'wp-content',
					'mu-plugins',
					'sqlite-database-integration',
					'load.php'
				),
				'utf8'
			)
		).toBe( 'sqlite mu-plugin' );
		expect( fs.readFileSync( path.join( sitePath, 'wp-config.php' ), 'utf8' ) ).toBe(
			'sqlite config'
		);
		expect( mocks.cliConfig.sites[ 0 ].databaseEngine ).toBeUndefined();
		expect( mocks.cliConfig.sites[ 0 ].mysql ).toBeUndefined();
	} );

	it( 'uses the SQLite source for export and imports the dump into the provisioned MySQL target', async () => {
		writeSqliteIntegration( sitePath );
		const site = siteData( sitePath );
		mocks.cliConfig.sites = [ site ];
		const targetMysql = mysqlConfig( { databaseName: 'target_database' } );
		mocks.createMysqlSiteConfig.mockReturnValue( targetMysql );

		const backup = await __testing.createBackup( site );
		await __testing.convertSqliteToMysql( site, backup, PHP_VERSION );

		const [ exportedSite, sqliteDumpPath ] = mocks.exportDatabaseToFile.mock.calls[ 0 ] as [
			SiteData,
			string,
		];
		expect( exportedSite ).toMatchObject( { id: site.id } );
		expect( exportedSite ).not.toHaveProperty( 'databaseEngine' );
		expect( exportedSite ).not.toHaveProperty( 'mysql' );
		expect( sqliteDumpPath ).toContain( 'convert-db-test.sql' );
		expect( mocks.importSqlFileIntoMysql ).toHaveBeenCalledWith(
			targetMysql,
			expect.stringContaining( 'convert-db-test.sql' )
		);
		expect( mocks.importDatabaseFromFile ).not.toHaveBeenCalled();
		expect( mocks.cliConfig.sites[ 0 ] ).toMatchObject( {
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: targetMysql,
		} );
	} );

	it( 'uses the MySQL source for export and imports into a SQLite target without mysql config', async () => {
		const sourceMysql = mysqlConfig( { databaseName: 'source_database' } );
		const site = siteData( sitePath, {
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: sourceMysql,
		} );
		mocks.cliConfig.sites = [ site ];

		const backup = await __testing.createBackup( site );
		await __testing.convertMysqlToSqlite( site, backup, PHP_VERSION );

		const [ exportedSite, mysqlDumpPath ] = mocks.exportDatabaseToFile.mock.calls[ 0 ] as [
			SiteData,
			string,
		];
		expect( exportedSite ).toMatchObject( {
			id: site.id,
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: sourceMysql,
		} );
		expect( mysqlDumpPath ).toContain( 'convert-db-test.sql' );
		const [ importedSite, sqliteDumpPath ] = mocks.importDatabaseFromFile.mock
			.calls[ 0 ] as unknown as [ SiteData, string ];
		expect( importedSite ).toMatchObject( {
			id: site.id,
			databaseEngine: DATABASE_ENGINE_SQLITE,
		} );
		expect( importedSite ).not.toHaveProperty( 'mysql' );
		expect( sqliteDumpPath ).toContain( 'convert-db-test.sql' );
		expect( mocks.importSqlFileIntoMysql ).not.toHaveBeenCalled();
		expect( mocks.cliConfig.sites[ 0 ].databaseEngine ).toBeUndefined();
		expect( mocks.cliConfig.sites[ 0 ].mysql ).toBeUndefined();
	} );

	it( 'restarts a site after successful conversion if it was running', async () => {
		const targetMysql = mysqlConfig( { databaseName: 'target_database' } );
		mocks.createMysqlSiteConfig.mockReturnValue( targetMysql );
		mocks.cliConfig.sites = [ siteData( sitePath ) ];
		mocks.isServerRunning.mockResolvedValue( processDescription );

		await runCommand( sitePath, DATABASE_ENGINE_MYSQL );

		expect( mocks.stopWordPressServer ).toHaveBeenCalledWith( 'site-id' );
		expect( mocks.startWordPressServer ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'site-id',
				databaseEngine: DATABASE_ENGINE_MYSQL,
				mysql: targetMysql,
			} ),
			expect.any( Object )
		);
		expect( mocks.updateSiteLatestCliPid ).toHaveBeenCalledWith(
			'site-id',
			processDescription.pid
		);
		expect( mocks.disconnectFromDaemon ).toHaveBeenCalled();
	} );

	it( 'restarts the rolled-back site and uses truthful rollback messaging', async () => {
		mocks.cliConfig.sites = [ siteData( sitePath ) ];
		mocks.isServerRunning.mockResolvedValue( processDescription );
		mocks.isWordPressInstalled.mockResolvedValue( false );

		let error: unknown;
		try {
			await runCommand( sitePath, DATABASE_ENGINE_MYSQL );
		} catch ( thrown ) {
			error = thrown;
		}

		expect( error ).toBeInstanceOf( Error );
		expect( ( error as Error ).message ).toContain(
			'Conversion failed and the site was rolled back to SQLite.'
		);
		expect( ( error as Error ).message ).not.toContain( 'The site is unchanged.' );
		expect( mocks.startWordPressServer ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'site-id',
			} ),
			expect.any( Object )
		);
	} );

	it( 'surfaces restart failure after successful conversion without rolling back conversion state', async () => {
		const targetMysql = mysqlConfig( { databaseName: 'target_database' } );
		mocks.createMysqlSiteConfig.mockReturnValue( targetMysql );
		mocks.cliConfig.sites = [ siteData( sitePath ) ];
		mocks.isServerRunning.mockResolvedValue( processDescription );
		mocks.startWordPressServer.mockRejectedValue( new Error( 'start failed' ) );

		await expect( runCommand( sitePath, DATABASE_ENGINE_MYSQL ) ).rejects.toThrow(
			'The site was stopped for conversion but WordPress server could not be restarted: start failed'
		);

		expect( mocks.cliConfig.sites[ 0 ] ).toEqual(
			expect.objectContaining( {
				databaseEngine: DATABASE_ENGINE_MYSQL,
				mysql: targetMysql,
			} )
		);
		expect( mocks.ensureMysqlServerRunning ).toHaveBeenCalled();
		expect( mocks.exportDatabaseToFile ).toHaveBeenCalled();
	} );
} );
