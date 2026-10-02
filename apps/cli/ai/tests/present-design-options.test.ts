import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { handOverOptions } from 'cli/ai/tools/present-design-options';

vi.mock( 'cli/ai/screenshot-storage', () => ( {
	resolveScreenshotDirectory: async () => os.tmpdir(),
} ) );
vi.mock( 'cli/ai/tools/screenshot-helpers', () => ( {
	captureScreenshotBuffer: async () => ( { buffer: Buffer.from( 'grid' ) } ),
	saveScreenshotFile: async () => ( { path: '/tmp/design-options.jpg' } ),
} ) );

const handOver = ( view?: 'picker' | 'widget' ) =>
	handOverOptions( {
		question: 'Which look should I build?',
		catalog: 'directions',
		options: [
			{
				label: 'Lookbook',
				description: 'Crisp and photo-led.',
				image: '/tmp/a.png',
				markup: '<p>A</p>',
			},
			{
				label: 'Midnight',
				description: 'Navy and amber.',
				image: '/tmp/b.png',
				markup: '<p>B</p>',
			},
		],
		view,
	} );

const texts = ( result: Awaited< ReturnType< typeof handOver > > ) =>
	result.content
		.flatMap( ( block ) => ( block.type === 'text' ? [ block.text ] : [] ) )
		.join( '\n' );

describe( 'handOverOptions', () => {
	it( 'leaves the question to the picker the host shows', async () => {
		const text = texts( await handOver( 'picker' ) );
		expect( text ).toContain( 'end your turn now' );
		expect( text ).not.toContain( 'show_widget' );
	} );

	it( 'hands an inline widget to hosts that render one', async () => {
		const text = texts( await handOver( 'widget' ) );
		expect( text ).toContain( 'show_widget' );
		expect( text ).toContain( '<' );
	} );

	it( 'asks with the grid image elsewhere, without mentioning a widget tool', async () => {
		const text = texts( await handOver() );
		expect( text ).toContain( '![Which look should I build?]' );
		expect( text ).toContain( '1. Lookbook: Crisp and photo-led.' );
		expect( text ).not.toContain( 'widget' );
	} );
} );
