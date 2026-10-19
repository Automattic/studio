// @vitest-environment node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { hasDefaultDbBlock } from '@studio/common/lib/remove-default-db-constants';
import { x } from 'tar';
import { runWpCliCommand, type WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { exportDatabaseToMultipleFiles } from '../../export-database';
import { DefaultExporter } from '../default-exporter';
import type { ExportOptions } from '../../types';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/run-wp-cli-command' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( '../../export-database' );

const config = `<?php
 define( 'DB_NAME', 'database_name_here' );
 define( 'DB_USER', 'username_here' );
 define( 'DB_PASSWORD', 'password_here' );
 define( 'DB_HOST', 'localhost' );
 define( 'DB_CHARSET', 'utf8mb4' );
 define( 'DB_COLLATE', '' );
 define( 'WP_ENVIRONMENT_TYPE', 'local' );
 $table_prefix = 'custom_';
`;
const sql = 'CREATE TABLE custom_options (option_id bigint);';

let tempDir: string;
let sitePath: string;
let configPath: string;

beforeEach( async () => {
	tempDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-export-test-' ) );
	sitePath = path.join( tempDir, 'site' );
	configPath = path.join( sitePath, 'wp-config.php' );
	await fs.mkdir( path.join( sitePath, 'wp-content', 'themes' ), { recursive: true } );
	await fs.writeFile( configPath, config );
	await fs.writeFile( path.join( sitePath, 'wp-content', 'themes', 'style.css' ), '/* theme */' );
	vi.mocked( runWpCliCommand ).mockResolvedValue( {
		response: {
			exitCode: Promise.resolve( 0 ),
			stdoutText: Promise.resolve( '[]' ),
			stderrText: Promise.resolve( '' ),
		} as WpCliResponse,
		[ Symbol.dispose ]: vi.fn(),
	} );
	vi.mocked( exportDatabaseToMultipleFiles ).mockImplementation( async ( _site, destination ) => {
		const sqlPath = path.join( destination, 'custom_options.sql' );
		await fs.writeFile( sqlPath, sql );
		return [ sqlPath ];
	} );
} );

afterEach( async () => {
	await fs.rm( tempDir, { recursive: true, force: true } );
} );

async function exportArchive( options: Partial< ExportOptions > = {} ) {
	const backupFile = path.join( tempDir, 'backup.tar.gz' );
	const exporter = new DefaultExporter( {
		site: { id: 'test-site', path: sitePath, port: 8881 } as SiteData,
		backupFile,
		includes: { wpContent: true, database: true },
		phpVersion: '8.3',
		splitDatabaseDumpByTable: true,
		...options,
	} );
	await exporter.export();
	const extracted = path.join( tempDir, 'extracted' );
	await fs.mkdir( extracted );
	await x( { file: backupFile, cwd: extracted } );
	return extracted;
}

describe( 'DefaultExporter archives', () => {
	it( 'omits wp-config.php without changing the local config when disabled', async () => {
		expect( hasDefaultDbBlock( config ) ).toBe( true );
		const extracted = await exportArchive( { includeWpConfig: false } );

		await expect( fs.stat( path.join( extracted, 'wp-config.php' ) ) ).rejects.toMatchObject( {
			code: 'ENOENT',
		} );
		expect( await fs.readFile( configPath, 'utf-8' ) ).toBe( config );
		expect(
			await fs.readFile( path.join( extracted, 'wp-content/themes/style.css' ), 'utf-8' )
		).toBe( '/* theme */' );
		expect( await fs.readFile( path.join( extracted, 'sql/custom_options.sql' ), 'utf-8' ) ).toBe(
			sql
		);
		expect(
			JSON.parse( await fs.readFile( path.join( extracted, 'meta.json' ), 'utf-8' ) )
		).toHaveProperty( 'siteUrl' );
	} );

	it.each( [ undefined, true ] )(
		'retains config export behavior with includeWpConfig=%s',
		async ( includeWpConfig ) => {
			const extracted = await exportArchive(
				includeWpConfig === undefined ? {} : { includeWpConfig }
			);
			const archivedConfig = await fs.readFile( path.join( extracted, 'wp-config.php' ), 'utf-8' );

			expect( hasDefaultDbBlock( archivedConfig ) ).toBe( false );
			expect( archivedConfig ).toContain( "define( 'WP_ENVIRONMENT_TYPE', 'local' );" );
			expect( archivedConfig ).toBe( await fs.readFile( configPath, 'utf-8' ) );
		}
	);
} );
