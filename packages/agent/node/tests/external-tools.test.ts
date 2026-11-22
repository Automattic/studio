import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { resolveExternalTools } from '@studio/agent/node/tools';
import { createFakeHost, fakeSite } from './fake-host';

describe( 'resolveExternalTools', () => {
	it( 'leads with studio_instructions and includes present_design_options', () => {
		const names = resolveExternalTools( createFakeHost() ).map( ( tool ) => tool.name );
		expect( names[ 0 ] ).toBe( 'studio_instructions' );
		expect( names ).toContain( 'present_design_options' );
	} );

	it( 'adds the declared settings of the core blocks a result shows, from the site the call names, once', async () => {
		const sitePath = path.join( mkdtempSync( path.join( tmpdir(), 'external-tools-' ) ), 'site' );
		const blockJson = path.join( sitePath, 'wp-includes', 'blocks', 'navigation', 'block.json' );
		mkdirSync( path.dirname( blockJson ), { recursive: true } );
		writeFileSync(
			blockJson,
			JSON.stringify( { attributes: { submenuVisibility: { enum: [ 'hover', 'click' ] } } } )
		);
		const host = createFakeHost();
		host.sites.resolve = vi.fn( async ( name: string ) => {
			if ( name !== 'My Site' ) {
				throw new Error( 'Site not found' );
			}
			return { ...fakeSite, path: sitePath };
		} );
		host.sites.wpCli = vi.fn( async () => ( {
			exitCode: 0,
			stdout: '<!-- wp:navigation /-->',
			stderr: '',
		} ) );
		const wpCli = resolveExternalTools( host ).find( ( tool ) => tool.name === 'wp_cli' )!;
		const notes = async ( nameOrPath: string ) =>
			( await wpCli.rawHandler( { nameOrPath, command: 'post list' } as never ) ).content
				.slice( 1 )
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) );

		await expect( notes( 'Missing Site' ) ).rejects.toThrow();
		expect( await notes( 'My Site' ) ).toEqual( [
			`core/navigation settings, declared in ${ blockJson
				.split( path.sep )
				.join( '/' ) }: submenuVisibility ("hover"|"click").`,
		] );
		// Once per connection, as once per Studio Code turn.
		expect( await notes( 'My Site' ) ).toEqual( [] );
	} );
} );
