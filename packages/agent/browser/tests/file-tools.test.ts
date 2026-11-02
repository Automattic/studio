import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileTools } from '@studio/agent/browser/file-tools';
import { createFakeHost } from '../../node/tests/fake-host';

describe( 'browser file tools', () => {
	let sitesRoot: string;
	let call: ( name: string, args: Record< string, unknown > ) => Promise< string >;

	beforeEach( async () => {
		sitesRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-web-files-' ) );
		const tools = Object.fromEntries(
			createFileTools( createFakeHost( sitesRoot ) ).map( ( tool ) => [ tool.name, tool ] )
		);
		call = async ( name, args ) => {
			const result = await tools[ name ].execute( 'call', args as never );
			return result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ).join( '' );
		};
	} );

	afterEach( async () => {
		await rm( sitesRoot, { recursive: true, force: true } );
	} );

	it( 'finds files under the sites root', async () => {
		await mkdir( path.join( sitesRoot, 'bakery', 'theme' ), { recursive: true } );
		await writeFile(
			path.join( sitesRoot, 'bakery', 'theme', 'style.css' ),
			'a { color: blue; }\nb {}\n'
		);

		expect( await call( 'Glob', { pattern: '*.css', path: 'bakery' } ) ).toBe( 'theme/style.css' );
		expect( await call( 'Grep', { pattern: 'BLUE', path: 'bakery', ignoreCase: true } ) ).toBe(
			'theme/style.css:1: a { color: blue; }'
		);
		expect( await call( 'Ls', { path: 'bakery' } ) ).toBe( 'theme/' );
	} );
} );
