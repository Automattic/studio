import { DATABASE_ENGINE_MYSQL, DATABASE_ENGINE_SQLITE } from '@studio/common/lib/database-engine';
import { encodePassword } from '@studio/common/lib/passwords';
import { describe, expect, it, vi } from 'vitest';
import { assertMysqlBinarySupportedForCurrentPlatform } from 'cli/lib/dependency-management/mysql-binary';
import { getDatabaseProvider, getDatabaseProviderForSite } from '../providers';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

vi.mock( 'cli/lib/dependency-management/mysql-binary' );

describe( 'database providers', () => {
	it( 'selects SQLite as the default provider', () => {
		const provider = getDatabaseProviderForSite( {} );

		expect( provider.engine ).toBe( DATABASE_ENGINE_SQLITE );
		expect( provider.requiresNativePhpRuntime ).toBe( false );
		expect( provider.usesSqliteIntegration ).toBe( true );
		expect( provider.requiresSqliteCliCommand ).toBe( true );
		expect( provider.getWpConfigConstants() ).toEqual( { DB_NAME: 'wordpress' } );
		expect( provider.getBlueprintDatabaseArgs( {} as never ) ).toEqual( [ '--db-engine=sqlite' ] );
		expect( provider.getExportDatabaseArgs( 'dump.sql' ) ).toEqual( [
			'sqlite',
			'export',
			'dump.sql',
			'--enable-ast-driver',
			'--skip-plugins',
			'--skip-themes',
		] );
		expect( provider.getImportDatabaseArgs( 'dump.sql' ) ).toEqual( [
			'sqlite',
			'import',
			'dump.sql',
			'--enable-ast-driver',
			'--skip-plugins',
			'--skip-themes',
		] );
	} );

	it( 'exposes MySQL wp-config constants and Blueprint args from site config', () => {
		const provider = getDatabaseProvider( DATABASE_ENGINE_MYSQL );
		const config: ServerConfig = {
			siteId: 'site-1',
			sitePath: '/tmp/site-1',
			port: 8881,
			databaseEngine: DATABASE_ENGINE_MYSQL,
			mysql: {
				host: '127.0.0.1',
				port: 3307,
				databaseName: 'studio_site',
				username: 'stu_site',
				password: encodePassword( 'mysql-password' ),
				serverVersion: '8.4.10',
				dataDir: '/tmp/studio-mysql/site',
			},
		};

		expect( provider.requiresNativePhpRuntime ).toBe( true );
		expect( provider.usesSqliteIntegration ).toBe( false );
		expect( provider.requiresSqliteCliCommand ).toBe( false );
		expect( provider.getWpConfigConstants( config ) ).toEqual( {
			DB_NAME: 'studio_site',
			DB_USER: 'stu_site',
			DB_PASSWORD: 'mysql-password',
			DB_HOST: '127.0.0.1:3307',
		} );
		expect( provider.getBlueprintDatabaseArgs( config ) ).toEqual( [
			'--db-engine=mysql',
			'--db-host=127.0.0.1:3307',
			'--db-user=stu_site',
			'--db-pass=mysql-password',
			'--db-name=studio_site',
		] );
		expect( provider.getExportDatabaseArgs( 'dump.sql' ) ).toEqual( [
			'db',
			'export',
			'dump.sql',
			'--skip-plugins',
			'--skip-themes',
		] );
		expect( provider.getImportDatabaseArgs( 'dump.sql' ) ).toEqual( [
			'db',
			'import',
			'dump.sql',
			'--skip-plugins',
			'--skip-themes',
		] );
	} );

	it( 'delegates MySQL platform preflight without rewriting errors', () => {
		const error = new Error( 'MySQL 8.4 is not available for this platform yet (linux-arm64).' );
		vi.mocked( assertMysqlBinarySupportedForCurrentPlatform ).mockImplementation( () => {
			throw error;
		} );

		expect( () => getDatabaseProvider( DATABASE_ENGINE_MYSQL ).preflight() ).toThrow( error );
	} );
} );
