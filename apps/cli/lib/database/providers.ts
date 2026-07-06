import {
	DATABASE_ENGINE_MYSQL,
	DATABASE_ENGINE_SQLITE,
	getSiteDatabaseEngine,
	type DatabaseEngine,
} from '@studio/common/lib/database-engine';
import { assertMysqlBinarySupportedForCurrentPlatform } from 'cli/lib/dependency-management/mysql-binary';
import {
	getMysqlConfigFromServerConfig,
	getMysqlWpConfigConstants,
} from 'cli/lib/mysql/mysql-site';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

export type DatabaseProvider = {
	engine: DatabaseEngine;
	requiresNativePhpRuntime: boolean;
	usesSqliteIntegration: boolean;
	requiresSqliteCliCommand: boolean;
	preflight(): void;
	getWpConfigConstants( config?: ServerConfig ): Record< string, string >;
	getBlueprintDatabaseArgs( config: ServerConfig ): string[];
	getExportDatabaseArgs( fileName: string ): string[];
	getImportDatabaseArgs( fileName: string ): string[];
};

const sqliteProvider: DatabaseProvider = {
	engine: DATABASE_ENGINE_SQLITE,
	requiresNativePhpRuntime: false,
	usesSqliteIntegration: true,
	requiresSqliteCliCommand: true,
	preflight: () => undefined,
	getWpConfigConstants: () => ( { DB_NAME: 'wordpress' } ),
	getBlueprintDatabaseArgs: () => [ '--db-engine=sqlite' ],
	getExportDatabaseArgs: ( fileName ) => [
		'sqlite',
		'export',
		fileName,
		'--enable-ast-driver',
		'--skip-plugins',
		'--skip-themes',
	],
	getImportDatabaseArgs: ( fileName ) => [
		'sqlite',
		'import',
		fileName,
		'--enable-ast-driver',
		'--skip-plugins',
		'--skip-themes',
	],
};

const mysqlProvider: DatabaseProvider = {
	engine: DATABASE_ENGINE_MYSQL,
	requiresNativePhpRuntime: true,
	usesSqliteIntegration: false,
	requiresSqliteCliCommand: false,
	preflight: () => assertMysqlBinarySupportedForCurrentPlatform(),
	getWpConfigConstants: ( config ) => {
		if ( ! config ) {
			throw new Error( 'MySQL site is missing database configuration.' );
		}
		const mysqlConfig = getMysqlConfigFromServerConfig( config );
		if ( ! mysqlConfig ) {
			throw new Error( 'MySQL site is missing database configuration.' );
		}
		return getMysqlWpConfigConstants( mysqlConfig );
	},
	getBlueprintDatabaseArgs: ( config ) => {
		const constants = mysqlProvider.getWpConfigConstants( config );
		return [
			'--db-engine=mysql',
			`--db-host=${ constants.DB_HOST }`,
			`--db-user=${ constants.DB_USER }`,
			`--db-pass=${ constants.DB_PASSWORD }`,
			`--db-name=${ constants.DB_NAME }`,
		];
	},
	getExportDatabaseArgs: ( fileName ) => [
		'db',
		'export',
		fileName,
		'--skip-plugins',
		'--skip-themes',
	],
	getImportDatabaseArgs: ( fileName ) => [
		'db',
		'import',
		fileName,
		'--skip-plugins',
		'--skip-themes',
	],
};

const databaseProviders: Record< DatabaseEngine, DatabaseProvider > = {
	[ DATABASE_ENGINE_SQLITE ]: sqliteProvider,
	[ DATABASE_ENGINE_MYSQL ]: mysqlProvider,
};

export function getDatabaseProvider( engine: DatabaseEngine ): DatabaseProvider {
	return databaseProviders[ engine ];
}

export function getDatabaseProviderForSite( site: {
	databaseEngine?: DatabaseEngine;
} ): DatabaseProvider {
	return getDatabaseProvider( getSiteDatabaseEngine( site ) );
}
