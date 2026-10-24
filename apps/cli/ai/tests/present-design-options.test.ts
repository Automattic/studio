import { readFileSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { renderDesignBoard } from 'cli/ai/design-board';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';

vi.mock( 'cli/ai/screenshot-storage', () => ( {
	resolveScreenshotDirectory: async () => os.tmpdir(),
} ) );
vi.mock( 'cli/ai/tools/screenshot-helpers', () => ( {
	captureScreenshotBuffer: async () => ( { buffer: Buffer.from( 'jpeg' ), contentHeight: 900 } ),
	saveScreenshotFile: async () => ( { path: '/tmp/design-options.jpg' } ),
} ) );

const args = {
	catalog: 'layouts' as const,
	question: 'Which layout should I build?',
	options: [
		{ label: 'Broadsheet', description: 'Newspaper columns.', preview: '<p>A</p>' },
		{ label: 'Collage', description: 'Overlapping photos.', preview: '<p>B</p>' },
	],
};

const textOf = (
	result: Awaited<
		ReturnType< ReturnType< typeof createPresentDesignOptionsTool >[ 'rawHandler' ] >
	>
) => result.content.map( ( block ) => ( block.type === 'text' ? block.text : '' ) ).join( '\n' );

describe( 'present_design_options', () => {
	it( 'hands the options back as a numbered grid when it cannot ask the user', async () => {
		const result = await createPresentDesignOptionsTool().rawHandler( args );

		expect( result.content[ 0 ] ).toMatchObject( { type: 'image', mimeType: 'image/jpeg' } );
		expect( textOf( result ) ).toContain(
			'![Which layout should I build?](/tmp/design-options.jpg)'
		);
		expect( textOf( result ) ).toContain( '2. Collage: Overlapping photos.' );
		expect( result._meta ).toBeUndefined();
	} );

	it( 'gives a picker the previews and tells the agent to end its turn', async () => {
		const result = await createPresentDesignOptionsTool( { picker: true } ).rawHandler( args );

		expect( textOf( result ) ).toContain( 'end your turn now' );
		expect( result._meta ).toEqual( {
			question: 'Which layout should I build?',
			options: [
				expect.objectContaining( {
					label: 'Broadsheet',
					image: expect.stringMatching( /^data:image\/jpeg;base64,/ ),
				} ),
				expect.objectContaining( { label: 'Collage' } ),
			],
		} );
	} );

	// A look is its theme.json: the board shows its tokens, and the picked one
	// is handed over as a file to become the theme's theme.json.
	it( 'renders a look from its theme.json and hands over the picked one as a file', async () => {
		const look = ( ground: string ) =>
			JSON.stringify( {
				version: 3,
				settings: {
					color: {
						palette: [
							{ slug: 'ground', color: ground },
							{ slug: 'ink', color: '#1b1b1b' },
							{ slug: 'brick', color: '#b5432a' },
						],
					},
					typography: {
						fontFamilies: [
							{ slug: 'display', name: 'Fraunces', fontFamily: '"Fraunces", serif' },
						],
					},
				},
				styles: {
					color: { background: 'var:preset|color|ground', text: 'var(--wp--preset--color--ink)' },
					typography: { fontFamily: 'var:preset|font-family|display' },
					elements: {
						button: {
							color: { background: 'var:preset|color|brick' },
							border: { radius: '999px' },
						},
					},
				},
			} );
		const board = renderDesignBoard( look( '#f6efe4' ) );
		expect( board ).toContain( 'background:#f6efe4;color:#1b1b1b' );
		expect( board ).toContain( 'family=Fraunces' );
		expect( board ).toContain( '.primary{background-color:#b5432a' );
		expect( board ).toContain( 'border-radius:999px' );

		const result = await createPresentDesignOptionsTool( {
			onAskUser: async () => ( { 'Which look should I build?': 'Night' } ),
		} ).rawHandler( {
			catalog: 'directions',
			question: 'Which look should I build?',
			options: [
				{ label: 'Day', description: 'Warm paper.', preview: look( '#f6efe4' ) },
				{ label: 'Night', description: 'Ink ground.', preview: look( '#101010' ) },
			],
		} );
		const file = textOf( result ).match( /theme\.json: (\S+)$/ )?.[ 1 ];
		expect( textOf( result ) ).toContain( 'The user picked option 2: Night.' );
		expect( readFileSync( file!, 'utf8' ) ).toBe( look( '#101010' ) );
	} );
} );
