import { describe, expect, it, vi } from 'vitest';
import { insertedBlock, type InsertedBlock } from 'cli/ai/block-validator';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { blockMarkupTool } from '../tools/block-markup';

vi.mock( 'cli/ai/block-validator', () => ( { insertedBlock: vi.fn() } ) );
vi.mock( 'cli/lib/wordpress-server-manager', () => ( { isServerRunning: vi.fn() } ) );
vi.mock( '../tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('../tools/utils') >() ),
	resolveSite: vi.fn( async () => ( {
		id: 'site-1',
		name: 'Bakery',
		path: '/sites/bakery',
		port: 8881,
	} ) ),
} ) );

const run = async ( args: { block: string; variation?: string } ) => {
	const result = await blockMarkupTool.execute(
		'call-1',
		{ nameOrPath: 'Bakery', ...args } as never,
		new AbortController().signal,
		() => {}
	);
	return ( result.content[ 0 ] as { text: string } ).text;
};

const form: InsertedBlock = {
	name: 'jetpack/contact-form',
	title: 'Form',
	variation: 'contact-form',
	variations: [ 'contact-form: Contact Form', 'rsvp-form: RSVP Form' ],
	markup: '<!-- wp:jetpack/contact-form /-->',
	children: [ 'jetpack/form-step' ],
	namespace: [ 'jetpack/field-name' ],
};

describe( 'block_markup', () => {
	it.each( [
		{
			name: 'a block with variations',
			block: form,
			variation: undefined,
			text: [
				'What the editor inserts for the contact-form variation:\n<!-- wp:jetpack/contact-form /-->',
				'Its variations in the inserter: contact-form: Contact Form; rsvp-form: RSVP Form.',
				'Blocks that go inside it: jetpack/form-step.',
				'Other blocks in its namespace: jetpack/field-name.',
			].join( '\n\n' ),
		},
		{
			name: 'a block without variations or children',
			block: {
				name: 'core/paragraph',
				title: 'Paragraph',
				variations: [],
				markup: '<!-- wp:paragraph -->',
				children: [],
				namespace: [ 'core/heading' ],
			},
			variation: undefined,
			text: 'What the editor inserts:\n<!-- wp:paragraph -->\n\nOther blocks in its namespace: core/heading.',
		},
		{
			name: 'a variation the inserter lacks',
			block: { ...form, variation: undefined, markup: undefined },
			variation: 'nope',
			text: 'Form (jetpack/contact-form) has no nope variation in the inserter.',
		},
		{
			name: 'a block not registered',
			block: {
				name: 'jetpack/form',
				variations: [],
				children: [],
				namespace: [ 'jetpack/contact-form' ],
			},
			variation: undefined,
			text: 'jetpack/form is not registered on the site.\nOther blocks in its namespace: jetpack/contact-form.',
		},
	] )( 'describes $name', async ( { block, variation, text } ) => {
		vi.mocked( isServerRunning ).mockResolvedValue( {} as never );
		vi.mocked( insertedBlock ).mockResolvedValue( block );
		expect( await run( { block: block.name, variation } ) ).toContain( text );
		expect( insertedBlock ).toHaveBeenLastCalledWith(
			block.name,
			'http://localhost:8881',
			variation
		);
	} );

	it( 'asks for the site to be started, as the block editor runs on it', async () => {
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		await expect( run( { block: 'core/paragraph' } ) ).rejects.toThrow(
			'Bakery is not running, and the block editor runs on the site. Start it with site_start.'
		);
	} );
} );
