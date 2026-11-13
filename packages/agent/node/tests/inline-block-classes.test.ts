import { writeFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { inlineBlockClasses } from '@studio/agent/node/inline-block-classes';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/shared/host';

describe( 'inlineBlockClasses', () => {
	// eval29 redo port 2: two classes' notes joined in one problem, and the one
	// left after the other was fixed raised again at the end of the turn.
	it( 'raises each class its own problem, and one fixed raises nothing again', async () => {
		const wordpress = createSite();
		const site = { path: wordpress.root, name: 'Black Lantern' } as HostSite;
		const host = createFakeHost();
		vi.mocked( host.sites.wpCli ).mockResolvedValue( {
			exitCode: 0,
			stdout: JSON.stringify( { used: [ 'bl-brand', 'bl-track' ] } ),
			stderr: '',
		} );
		const open = new OpenProblems( [] );
		const changes = new SiteChanges( host, open, async () => [ site ], [ inlineBlockClasses ] );
		const css = path.join( wordpress.root, 'wp-content/themes/bakery/style.css' );
		const write = ( rules: string ) =>
			writeFileSync( css, `/*\nTheme Name: Bakery\n*/\n${ rules }` );
		await changes.snapshot();

		write( '.bl-brand { display: inline-flex; }\n.bl-track { display: inline-block; }' );
		await changes.settle();
		const raised = await open.raise();
		expect( raised ).toHaveLength( 2 );
		expect( raised[ 0 ] ).toMatch( /^Black Lantern: .*`\.bl-brand` is a block className/ );
		expect( raised[ 1 ] ).toMatch( /^Black Lantern: .*`\.bl-track` is a block className/ );

		write( '.bl-track { display: inline-block; }' );
		await changes.settle();
		expect( await open.raise() ).toEqual( [] );
		// Still open, said again at the second look.
		open.look();
		expect( open.look() ).toEqual( [ raised[ 1 ] ] );

		const record = vi.spyOn( open, 'record' );
		write( '' );
		await changes.settle();
		expect( record.mock.calls.filter( ( [ , , problem ] ) => problem ) ).toEqual( [] );
		expect( record.mock.calls.map( ( [ , key ] ) => key ) ).toEqual(
			expect.arrayContaining( [ expect.stringContaining( '`.bl-track`' ) ] )
		);
		expect( await open.raise() ).toEqual( [] );
	} );
} );
