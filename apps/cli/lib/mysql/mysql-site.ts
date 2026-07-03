import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATABASE_ENGINE_MYSQL, type MysqlSiteConfig } from '@studio/common/lib/database-engine';
import { getConfiguredMysqlBinaryVersion } from '@studio/common/lib/mysql-binary-metadata';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { getMysqlDataRoot } from 'cli/lib/dependency-management/paths';
import { runMysqlQuery } from './mysql-process';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

type MysqlProvisionMarker = {
	databaseName: string;
	username: string;
	serverVersion: string;
};

const MYSQL_IDENTIFIER_MAX_LENGTH = 64;
const MYSQL_USERNAME_MAX_LENGTH = 32;

export function createMysqlSiteConfig( siteId: string, port: number ): MysqlSiteConfig {
	const token = getSiteToken( siteId );
	const serverVersion = getConfiguredMysqlBinaryVersion();
	if ( ! serverVersion ) {
		throw new Error( 'No managed MySQL server version is configured.' );
	}

	return {
		host: '127.0.0.1',
		port,
		databaseName: trimIdentifier( `studio_${ token }`, MYSQL_IDENTIFIER_MAX_LENGTH ),
		username: trimIdentifier( `stu_${ token }`, MYSQL_USERNAME_MAX_LENGTH ),
		password: encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) ),
		serverVersion,
		dataDir: path.join( getMysqlDataRoot(), siteId ),
	};
}

export function getMysqlWpConfigConstants( config: MysqlSiteConfig ): Record< string, string > {
	return {
		DB_NAME: config.databaseName,
		DB_USER: config.username,
		DB_PASSWORD: decodePassword( config.password ),
		DB_HOST: `${ config.host }:${ config.port }`,
	};
}

export function getMysqlConfigFromServerConfig(
	config: ServerConfig
): MysqlSiteConfig | undefined {
	if ( config.databaseEngine !== DATABASE_ENGINE_MYSQL ) {
		return undefined;
	}
	if ( ! config.mysql ) {
		throw new Error( 'MySQL site is missing database configuration.' );
	}
	return config.mysql;
}

export async function prepareMysqlSite(
	config: MysqlSiteConfig,
	sitePath: string
): Promise< void > {
	await removeSqliteIntegrationForMysql( sitePath );
	await provisionMysqlDatabase( config );
}

// Default collation for freshly created databases. The `studio create` path
// uses this. The SQLite→MySQL convert path overrides it to match the collation
// the export driver emits per-table (utf8mb4_0900_ai_ci), so the database
// default and the imported tables agree instead of silently diverging.
const DEFAULT_DATABASE_COLLATION = 'utf8mb4_unicode_ci';

export async function provisionMysqlDatabase(
	config: MysqlSiteConfig,
	options: { collation?: string } = {}
): Promise< void > {
	const collation = options.collation ?? DEFAULT_DATABASE_COLLATION;
	assertSafeCollation( collation );
	const markerPath = getProvisionMarkerPath( config );
	const hasMarker = fs.existsSync( markerPath );
	const databaseExists = await mysqlDatabaseExists( config );
	const userExists = await mysqlUserExists( config );

	if ( ! hasMarker && ( databaseExists || userExists ) ) {
		throw new Error(
			`Refusing to attach MySQL site to existing database/user without Studio marker: ${ config.databaseName }`
		);
	}

	if ( ! hasMarker ) {
		await runMysqlQuery(
			config,
			[
				`CREATE DATABASE ${ sqlIdentifier(
					config.databaseName
				) } CHARACTER SET utf8mb4 COLLATE ${ collation }`,
				...createUserStatements( config, false ),
				...grantStatements( config ),
				'FLUSH PRIVILEGES',
			].join( ';\n' ) + ';'
		);
		await writeProvisionMarker( config, markerPath );
		return;
	}

	if ( ! databaseExists ) {
		await runMysqlQuery(
			config,
			`CREATE DATABASE ${ sqlIdentifier(
				config.databaseName
			) } CHARACTER SET utf8mb4 COLLATE ${ collation };`
		);
	}

	if ( ! userExists ) {
		await runMysqlQuery( config, createUserStatements( config, true ).join( ';\n' ) + ';' );
	}

	await runMysqlQuery(
		config,
		[ ...grantStatements( config ), 'FLUSH PRIVILEGES' ].join( ';\n' ) + ';'
	);
}

export async function removeSqliteIntegrationForMysql( sitePath: string ): Promise< void > {
	const dbPhpPath = path.join( sitePath, 'wp-content', 'db.php' );
	if ( fs.existsSync( dbPhpPath ) ) {
		const content = await fs.promises.readFile( dbPhpPath, 'utf8' );
		if ( content.includes( '@studio-keep' ) ) {
			throw new Error( 'Cannot use MySQL while wp-content/db.php is marked @studio-keep.' );
		}
		if (
			! content.includes( 'sqlite-database-integration' ) &&
			! content.includes( 'SQLITE_DB_DROPIN_VERSION' )
		) {
			throw new Error( 'Cannot use MySQL with an unknown wp-content/db.php drop-in.' );
		}
		await fs.promises.rm( dbPhpPath, { force: true } );
	}

	await fs.promises.rm(
		path.join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ),
		{
			recursive: true,
			force: true,
		}
	);
}

async function mysqlDatabaseExists( config: MysqlSiteConfig ): Promise< boolean > {
	const stdout = await runMysqlQuery(
		config,
		`SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ${ sqlLiteral(
			config.databaseName
		) };`
	);
	return Number( stdout.trim() ) > 0;
}

async function mysqlUserExists( config: MysqlSiteConfig ): Promise< boolean > {
	const stdout = await runMysqlQuery(
		config,
		`SELECT COUNT(*) FROM mysql.user WHERE User = ${ sqlLiteral(
			config.username
		) } AND Host IN ('localhost', '127.0.0.1');`
	);
	return Number( stdout.trim() ) > 0;
}

function createUserStatements( config: MysqlSiteConfig, ifNotExists: boolean ): string[] {
	const password = decodePassword( config.password );
	const existsClause = ifNotExists ? ' IF NOT EXISTS' : '';
	return [ 'localhost', '127.0.0.1' ].map(
		( host ) =>
			`CREATE USER${ existsClause } ${ sqlUser(
				config.username,
				host
			) } IDENTIFIED BY ${ sqlLiteral( password ) }`
	);
}

function grantStatements( config: MysqlSiteConfig ): string[] {
	return [ 'localhost', '127.0.0.1' ].map(
		( host ) =>
			`GRANT ALL PRIVILEGES ON ${ sqlIdentifier( config.databaseName ) }.* TO ${ sqlUser(
				config.username,
				host
			) }`
	);
}

function writeProvisionMarker( config: MysqlSiteConfig, markerPath: string ): Promise< void > {
	const marker: MysqlProvisionMarker = {
		databaseName: config.databaseName,
		username: config.username,
		serverVersion: config.serverVersion,
	};
	fs.mkdirSync( path.dirname( markerPath ), { recursive: true } );
	return fs.promises.writeFile( markerPath, JSON.stringify( marker, null, 2 ) + '\n', 'utf8' );
}

function getProvisionMarkerPath( config: MysqlSiteConfig ): string {
	return path.join( config.dataDir, '.studio-mysql-provisioned.json' );
}

function getSiteToken( siteId: string ): string {
	const normalized = siteId.replace( /[^a-zA-Z0-9]/g, '' ).toLowerCase();
	return normalized.slice( 0, 24 ) || crypto.randomBytes( 12 ).toString( 'hex' );
}

function trimIdentifier( value: string, maxLength: number ): string {
	return value.slice( 0, maxLength );
}

function assertSafeCollation( value: string ): void {
	if ( ! /^[a-zA-Z0-9_]+$/.test( value ) ) {
		throw new Error( `Invalid MySQL collation: ${ value }` );
	}
}

function sqlIdentifier( value: string ): string {
	if ( ! /^[a-zA-Z0-9_]+$/.test( value ) ) {
		throw new Error( `Invalid MySQL identifier: ${ value }` );
	}
	return `\`${ value }\``;
}

function sqlLiteral( value: string ): string {
	return `'${ value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
}

function sqlUser( username: string, host: string ): string {
	return `${ sqlLiteral( username ) }@${ sqlLiteral( host ) }`;
}
