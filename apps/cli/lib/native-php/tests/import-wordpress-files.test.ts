/** @vitest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getImporter } from 'cli/lib/import-export/import/import-manager';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { importWordPressFiles } from '../import-wordpress-files';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

vi.mock( 'cli/lib/cli-config/sites' );
vi.mock( 'cli/lib/import-export/import/import-manager' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( '../site-setup', () => ( { ensureWpConfig: vi.fn() } ) );

let root: string;
let config: ServerConfig;
const restore = vi.fn();

beforeEach( async () => {
	root = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-snapshot-resource-' ) );
	await fs.mkdir( path.join( root, 'bundle' ) );
	await fs.writeFile( path.join( root, 'bundle/site.zip' ), 'snapshot' );
	await fs.writeFile( path.join( root, 'outside.zip' ), 'outside' );
	config = { siteId: 'destination', sitePath: path.join( root, 'destination' ), port: 9010 };
	vi.mocked( getSiteByFolder ).mockResolvedValue( {
		id: 'destination',
		path: config.sitePath,
	} as Awaited< ReturnType< typeof getSiteByFolder > > );
	vi.mocked( getImporter ).mockReturnValue( { import: restore } as unknown as ReturnType<
		typeof getImporter
	> );
	restore.mockReset().mockResolvedValue( {} );
} );

afterEach( async () => {
	await fs.rm( root, { recursive: true, force: true } );
} );

const step = ( resourcePath: string ) => ( {
	step: 'importWordPressFiles' as const,
	wordPressFilesZip: { resource: 'bundled' as const, path: resourcePath },
} );

it( 'restores bundled snapshots through the existing archive importer', async () => {
	await importWordPressFiles(
		config,
		step( '/site.zip' ),
		path.join( root, 'bundle/blueprint.json' ),
		'8.4',
		new AbortController().signal
	);
	expect( getImporter ).toHaveBeenCalledWith(
		{ path: await fs.realpath( path.join( root, 'bundle/site.zip' ) ), type: 'application/zip' },
		expect.anything()
	);
	expect( restore ).toHaveBeenCalledWith( expect.objectContaining( { path: config.sitePath } ) );
	expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( config.sitePath );
} );

it.each( [ '../outside.zip', 'escape.zip' ] )(
	'rejects resources escaping the bundle: %s',
	async ( resourcePath ) => {
		await fs.symlink( path.join( root, 'outside.zip' ), path.join( root, 'bundle/escape.zip' ) );
		await expect(
			importWordPressFiles(
				config,
				step( resourcePath ),
				path.join( root, 'bundle/blueprint.json' ),
				'8.4',
				new AbortController().signal
			)
		).rejects.toThrow( 'inside its resource directory' );
		expect( restore ).not.toHaveBeenCalled();
	}
);

it( 'does not restore a cancelled Blueprint', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		importWordPressFiles(
			config,
			step( 'site.zip' ),
			path.join( root, 'bundle/blueprint.json' ),
			'8.4',
			controller.signal
		)
	).rejects.toThrow();
	expect( restore ).not.toHaveBeenCalled();
} );

it( 'rejects unsupported subdirectory imports before changing the site', async () => {
	await expect(
		importWordPressFiles(
			config,
			{ ...step( 'site.zip' ), pathInZip: 'nested' },
			path.join( root, 'bundle/blueprint.json' ),
			'8.4',
			new AbortController().signal
		)
	).rejects.toThrow( 'pathInZip' );
	expect( restore ).not.toHaveBeenCalled();
} );
