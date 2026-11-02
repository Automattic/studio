import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteContainingFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
} ) );

describe( 'getSiteContainingFolder', () => {
	let root: string;
	let sitePath: string;

	beforeEach( () => {
		root = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sites-' ) ) );
		sitePath = path.join( root, 'my-site' );
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'themes', 'demo' ), { recursive: true } );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ { id: '1', name: 'My Site', path: sitePath } ],
		} as unknown as Awaited< ReturnType< typeof readCliConfig > > );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'finds the site from its root', async () => {
		expect( ( await getSiteContainingFolder( sitePath ) ).path ).toBe( sitePath );
	} );

	it( 'finds the site from a directory inside it', async () => {
		const theme = path.join( sitePath, 'wp-content', 'themes', 'demo' );
		expect( ( await getSiteContainingFolder( theme ) ).path ).toBe( sitePath );
	} );

	it( 'reports a directory outside every site', async () => {
		await expect( getSiteContainingFolder( root ) ).rejects.toThrow( 'not added to Studio' );
	} );
} );
