import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import { exportStaticContent } from 'cli/lib/static-content';

vi.mock( 'cli/commands/export-static' );

let sitePath: string;
let outputDir: string;

beforeEach( () => {
	sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'static-content-site-' ) );
	outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'static-content-out-' ) );
	fs.writeFileSync( path.join( sitePath, '_redirects' ), '/old /new 301' );
	vi.mocked( exportStaticSite ).mockImplementation( async ( _site, dir ) => {
		fs.mkdirSync( path.join( dir, 'about' ), { recursive: true } );
		fs.writeFileSync( path.join( dir, 'index.html' ), 'home' );
		fs.writeFileSync( path.join( dir, 'about', 'index.html' ), 'about' );
	} );
} );

afterEach( () => {
	vi.resetAllMocks();
	fs.rmSync( sitePath, { recursive: true, force: true } );
	fs.rmSync( outputDir, { recursive: true, force: true } );
} );

it( 'exports the site with links to where it will be hosted, with the files kept at its root', async () => {
	const beforeExport = async () => {};
	const content = await exportStaticContent(
		sitePath,
		'https://my-site.space.fast',
		outputDir,
		beforeExport
	);

	expect( exportStaticSite ).toHaveBeenCalledWith(
		sitePath,
		outputDir,
		'https://my-site.space.fast',
		true,
		beforeExport
	);
	if ( content.kind !== 'files' ) {
		throw new Error( 'Expected files' );
	}
	const published = Object.fromEntries(
		await Promise.all(
			content.files.map( async ( file ) => [
				file.path,
				new TextDecoder().decode( await file.read() ),
			] )
		)
	);
	expect( published ).toEqual( {
		'index.html': 'home',
		'about/index.html': 'about',
		_redirects: '/old /new 301',
	} );
} );
