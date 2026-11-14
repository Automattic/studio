import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBlockSettingsNotes } from '@studio/agent/shared/block-settings';
import { createFakeHost } from './fake-host';

const HEADER = `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
	<!-- wp:site-title {"level":0} /-->
	<!-- wp:navigation /-->
	<!-- wp:acme/badge /-->
</div>
<!-- /wp:group -->`;

const host = createFakeHost();

describe( 'createBlockSettingsNotes', () => {
	let blocksDir: string;

	function declare( slug: string, attributes: Record< string, unknown > ) {
		mkdirSync( path.join( blocksDir, slug ), { recursive: true } );
		writeFileSync(
			path.join( blocksDir, slug, 'block.json' ),
			JSON.stringify( { name: `core/${ slug }`, attributes } )
		);
	}

	beforeEach( () => {
		blocksDir = path.join( mkdtempSync( path.join( tmpdir(), 'block-settings-' ) ), 'blocks' );
		declare( 'navigation', {
			ref: { type: 'number' },
			submenuVisibility: { type: 'string', enum: [ 'hover', 'click', 'always' ], default: 'hover' },
			showSubmenuIcon: { type: 'boolean', default: true },
			__unstableLocation: { type: 'string' },
		} );
		declare( 'site-title', { level: { type: 'number', default: 1 } } );
		declare( 'group', { tagName: { type: 'string', default: 'div' } } );
		declare( 'paragraph', { content: { type: 'rich-text', source: 'rich-text', selector: 'p' } } );
	} );

	afterEach( () => {
		rmSync( path.dirname( blocksDir ), { recursive: true, force: true } );
	} );

	it( 'describes each core block type in the markup from its block.json', async () => {
		const notes = ( await createBlockSettingsNotes( host, blocksDir )( HEADER ) ).split( '\n' );

		const where = blocksDir.split( path.sep ).join( '/' );
		expect( notes ).toEqual( [
			`core/group settings, declared in ${ where }/group/block.json: tagName (string, default "div").`,
			`core/site-title settings, declared in ${ where }/site-title/block.json: level (number, default 1).`,
			`core/navigation settings, declared in ${ where }/navigation/block.json: ref (number), submenuVisibility ("hover"|"click"|"always", default "hover"), showSubmenuIcon (boolean, default true).`,
		] );
	} );

	it( 'describes a block type once', async () => {
		const notes = createBlockSettingsNotes( host, blocksDir );

		expect( await notes( HEADER ) ).toContain( 'core/navigation' );
		expect( await notes( '<!-- wp:core/navigation {"ref":4} /-->' ) ).toBe( '' );
	} );

	it( 'leaves out content attributes, closing comments and undeclared blocks', async () => {
		const notes = createBlockSettingsNotes( host, blocksDir );

		expect( await notes( '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->' ) ).toBe( '' );
		expect( await notes( '<!-- /wp:group --><!-- wp:quote /-->' ) ).toBe( '' );
		expect( await notes( 'No blocks here.' ) ).toBe( '' );
	} );
} );
