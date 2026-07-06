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
	preflight(): void;
	getWpConfigConstants( config?: ServerConfig ): Record< string, string >;
	getBlueprintDatabaseArgs( config: ServerConfig ): string[];
};

const sqliteProvider: DatabaseProvider = {
	engine: DATABASE_ENGINE_SQLITE,
	requiresNativePhpRuntime: false,
	usesSqliteIntegration: true,
	preflight: () => undefined,
	getWpConfigConstants: () => ( { DB_NAME: 'wordpress' } ),
	getBlueprintDatabaseArgs: () => [ '--db-engine=sqlite' ],
};

const mysqlProvider: DatabaseProvider = {
	engine: DATABASE_ENGINE_MYSQL,
	requiresNativePhpRuntime: true,
	usesSqliteIntegration: false,
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
