import { z } from 'zod';

export const DATABASE_ENGINE_SQLITE = 'sqlite';
export const DATABASE_ENGINE_MYSQL = 'mysql';

export const databaseEngineSchema = z.enum( [ DATABASE_ENGINE_SQLITE, DATABASE_ENGINE_MYSQL ] );
export type DatabaseEngine = z.infer< typeof databaseEngineSchema >;

export const mysqlSiteConfigSchema = z.object( {
	host: z.string().min( 1 ),
	port: z.number().int().min( 1 ).max( 65535 ),
	databaseName: z.string().min( 1 ),
	username: z.string().min( 1 ),
	password: z.string().min( 1 ),
	serverVersion: z.string().min( 1 ),
	dataDir: z.string().min( 1 ),
} );

export type MysqlSiteConfig = z.infer< typeof mysqlSiteConfigSchema >;

export function getSiteDatabaseEngine( site: { databaseEngine?: DatabaseEngine } ): DatabaseEngine {
	return site.databaseEngine ?? DATABASE_ENGINE_SQLITE;
}

export function isMysqlSite( site: { databaseEngine?: DatabaseEngine } ): boolean {
	return getSiteDatabaseEngine( site ) === DATABASE_ENGINE_MYSQL;
}
