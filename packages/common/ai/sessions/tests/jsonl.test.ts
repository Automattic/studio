import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFirstJsonlLine, readJsonlLines } from '../jsonl';

async function collect( filePath: string, options?: { maxLineLength?: number } ) {
	const lines: string[] = [];
	for await ( const line of readJsonlLines( filePath, options ) ) {
		lines.push( line );
	}
	return lines;
}

describe( 'readJsonlLines', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	async function writeFixture( content: string ): Promise< string > {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-jsonl-' ) );
		const filePath = path.join( rootDirectory, 'file.jsonl' );
		await fs.writeFile( filePath, content, 'utf8' );
		return filePath;
	}

	it( 'splits LF, CRLF, and lone-CR line endings identically', async () => {
		const filePath = await writeFixture( '{"a":1}\n{"b":2}\r\n{"c":3}\r{"d":4}' );
		await expect( collect( filePath ) ).resolves.toEqual( [
			'{"a":1}',
			'{"b":2}',
			'{"c":3}',
			'{"d":4}',
		] );
	} );

	it( 'skips blank lines and trims whitespace', async () => {
		const filePath = await writeFixture( '  {"a":1}  \n\n\t\n{"b":2}\n' );
		await expect( collect( filePath ) ).resolves.toEqual( [ '{"a":1}', '{"b":2}' ] );
	} );

	it( 'skips oversized lines without buffering them, keeping later lines intact', async () => {
		const filePath = await writeFixture(
			[ '{"a":1}', `{"big":"${ 'x'.repeat( 5000 ) }"}`, '{"b":2}' ].join( '\n' )
		);
		await expect( collect( filePath, { maxLineLength: 1024 } ) ).resolves.toEqual( [
			'{"a":1}',
			'{"b":2}',
		] );
	} );

	it( 'skips an oversized line spanning multiple stream chunks', async () => {
		const filePath = await writeFixture(
			`{"a":1}\n{"big":"${ 'x'.repeat( 200_000 ) }"}\n{"b":2}\n`
		);
		await expect( collect( filePath, { maxLineLength: 1024 } ) ).resolves.toEqual( [
			'{"a":1}',
			'{"b":2}',
		] );
	} );

	it( 'skips an oversized line with no trailing newline', async () => {
		const filePath = await writeFixture( `{"a":1}\n{"big":"${ 'x'.repeat( 5000 ) }"}` );
		await expect( collect( filePath, { maxLineLength: 1024 } ) ).resolves.toEqual( [ '{"a":1}' ] );
	} );

	it( 'rejects with ENOENT for a missing file', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-jsonl-' ) );
		await expect( collect( path.join( rootDirectory, 'missing.jsonl' ) ) ).rejects.toMatchObject( {
			code: 'ENOENT',
		} );
	} );
} );

describe( 'readFirstJsonlLine', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'returns the first non-empty line, or undefined for an empty file', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-jsonl-' ) );
		const filePath = path.join( rootDirectory, 'file.jsonl' );

		await fs.writeFile( filePath, '\n\n{"a":1}\n{"b":2}\n', 'utf8' );
		await expect( readFirstJsonlLine( filePath ) ).resolves.toBe( '{"a":1}' );

		await fs.writeFile( filePath, '', 'utf8' );
		await expect( readFirstJsonlLine( filePath ) ).resolves.toBeUndefined();
	} );
} );
