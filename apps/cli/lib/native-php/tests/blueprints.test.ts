import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATABASE_ENGINE_MYSQL } from '@studio/common/lib/database-engine';
import { encodePassword } from '@studio/common/lib/passwords';
import { vi } from 'vitest';
import { runBlueprint } from 'cli/lib/native-php/blueprints';
import { runPhpCommand } from 'cli/lib/native-php/php-process';

vi.mock( '@studio/common/lib/blueprint-bundle', () => ( {
	createBlueprintTempDir: vi.fn(),
	removeBlueprintTempDir: vi.fn(),
} ) );

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getBlueprintsPharPath: vi.fn( () => '/server-files/blueprints.phar' ),
	getPhpBinaryPath: vi.fn( () => '/server-files/php/bin/php' ),
} ) );

vi.mock( 'cli/lib/native-php/php-process', () => ( {
	runPhpCommand: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'native PHP blueprints', () => {
	let tempDir: string;

	beforeEach( () => {
		tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-blueprints-test-' ) );
		vi.clearAllMocks();
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'passes generated MySQL connection details to blueprints.phar', async () => {
		const blueprintPath = path.join( tempDir, 'blueprint.json' );
		fs.writeFileSync( blueprintPath, JSON.stringify( { steps: [] } ) );

		await runBlueprint(
			{
				siteId: 'test-site',
				sitePath: path.join( tempDir, 'site' ),
				port: 8881,
				databaseEngine: DATABASE_ENGINE_MYSQL,
				mysql: {
					host: '127.0.0.1',
					port: 8890,
					databaseName: 'studio_testsite',
					username: 'stu_testsite',
					password: encodePassword( 'mysql-password' ),
					serverVersion: '8.4.10',
					dataDir: path.join( tempDir, 'mysql' ),
				},
			},
			{
				uri: blueprintPath,
				contents: { steps: [] },
			},
			'8.4',
			new AbortController().signal
		);

		expect( runPhpCommand ).toHaveBeenCalledWith(
			expect.arrayContaining( [
				'--db-engine=mysql',
				'--db-host=127.0.0.1:8890',
				'--db-user=stu_testsite',
				'--db-pass=mysql-password',
				'--db-name=studio_testsite',
			] ),
			expect.any( Object )
		);
	} );
} );
