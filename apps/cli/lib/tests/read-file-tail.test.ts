import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileTail } from 'cli/lib/read-file-tail';

describe( 'readFileTail', () => {
	let dir: string;

	beforeEach( async () => {
		dir = await mkdtemp( join( tmpdir(), 'studio-test-tail-' ) );
	} );

	it( 'should return the whole file when smaller than maxBytes', async () => {
		const filePath = join( dir, 'small.log' );
		await writeFile( filePath, 'line one\nline two\n' );

		expect( await readFileTail( filePath, 1024 ) ).toBe( 'line one\nline two' );
	} );

	it( 'should return the trailing bytes and drop the partial first line when truncated', async () => {
		const filePath = join( dir, 'large.log' );
		await writeFile( filePath, 'first line is long\nsecond line\nthird line\n' );

		expect( await readFileTail( filePath, 'second line\nthird line\n'.length ) ).toBe(
			'third line'
		);
	} );

	it( 'should return an empty string for an empty file', async () => {
		const filePath = join( dir, 'empty.log' );
		await writeFile( filePath, '' );

		expect( await readFileTail( filePath, 1024 ) ).toBe( '' );
	} );

	it( 'should reject for a missing file', async () => {
		await expect( readFileTail( join( dir, 'missing.log' ), 1024 ) ).rejects.toThrow();
	} );
} );
