import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileTools } from '@studio/agent/browser/file-tools';
import { bindTool } from '@studio/agent/shared/tools/define-tool';
import { createFakeHost } from '../../node/tests/fake-host';

describe( 'web file tools', () => {
	let sitesRoot: string;
	let call: ( name: string, args: Record< string, unknown > ) => Promise< string >;

	beforeEach( async () => {
		sitesRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-web-files-' ) );
		const host = createFakeHost( sitesRoot );
		const tools = Object.fromEntries(
			createFileTools( host ).map( ( definition ) => [
				definition.name,
				bindTool( definition, host ),
			] )
		);
		call = async ( name, args ) => {
			const result = await tools[ name ].rawHandler( args as never );
			return result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ).join( '' );
		};
	} );

	afterEach( async () => {
		await rm( sitesRoot, { recursive: true, force: true } );
	} );

	it( 'writes, edits, reads and finds files under the sites root', async () => {
		await call( 'Write', { path: 'bakery/theme/style.css', content: 'a { color: red; }\nb {}\n' } );
		await call( 'Edit', {
			path: 'bakery/theme/style.css',
			edits: [ { oldText: 'red', newText: 'blue' } ],
		} );

		expect( await call( 'Read', { path: 'bakery/theme/style.css', offset: 1, limit: 1 } ) ).toBe(
			'a { color: blue; }\n\n[Showing lines 1-1 of 3. Use offset=2 to continue.]'
		);
		expect( await call( 'Glob', { pattern: '*.css', path: 'bakery' } ) ).toBe( 'theme/style.css' );
		expect( await call( 'Grep', { pattern: 'BLUE', path: 'bakery', ignoreCase: true } ) ).toBe(
			'theme/style.css:1: a { color: blue; }'
		);
		expect( await call( 'Ls', { path: 'bakery' } ) ).toBe( 'theme/' );
	} );

	it( 'refuses an edit whose text is missing or not unique', async () => {
		await call( 'Write', { path: 'bakery/a.txt', content: 'x x' } );

		await expect(
			call( 'Edit', { path: 'bakery/a.txt', edits: [ { oldText: 'y', newText: 'z' } ] } )
		).rejects.toThrow( 'Could not find the exact text' );
		await expect(
			call( 'Edit', { path: 'bakery/a.txt', edits: [ { oldText: 'x', newText: 'z' } ] } )
		).rejects.toThrow( 'more than one match' );
	} );
} );
