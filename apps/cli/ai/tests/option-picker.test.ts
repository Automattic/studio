import { describe, expect, it } from 'vitest';
import { buildOptionPickerLines } from '../option-picker';

// eslint-disable-next-line no-control-regex
const stripAnsi = ( text: string ) => text.replace( /\u001b\[[0-9;]*m/g, '' );

const ITEMS = [
	{
		value: 'Blocks + products',
		label: '1. Blocks + products (Recommended)',
		description: 'Native, fully editable WordPress blocks. Best launchpad for a redesign.',
	},
	{
		value: 'Theme replication',
		label: '2. Theme replication',
		description: 'Pixel-accurate replica of the source.',
	},
	{ value: '__other__', label: 'Other (type my own)' },
];

describe( 'buildOptionPickerLines', () => {
	it( 'renders each option label followed by its indented description', () => {
		const lines = buildOptionPickerLines( ITEMS, 'Blocks + products', 100 ).map( stripAnsi );
		expect( lines ).toEqual( [
			'→ 1. Blocks + products (Recommended)',
			'     Native, fully editable WordPress blocks. Best launchpad for a redesign.',
			'  2. Theme replication',
			'     Pixel-accurate replica of the source.',
			'  Other (type my own)',
		] );
	} );

	it( 'marks the selected item with an arrow prefix', () => {
		const lines = buildOptionPickerLines( ITEMS, 'Theme replication', 100 ).map( stripAnsi );
		expect( lines[ 0 ] ).toBe( '  1. Blocks + products (Recommended)' );
		expect( lines[ 2 ] ).toBe( '→ 2. Theme replication' );
	} );

	it( 'wraps long descriptions across multiple indented lines without truncation', () => {
		const lines = buildOptionPickerLines( ITEMS, undefined, 40 ).map( stripAnsi );
		const descriptionLines = lines.filter( ( line ) => line.startsWith( '     ' ) );
		expect( descriptionLines.length ).toBeGreaterThan( 2 );
		expect( descriptionLines.join( ' ' ).replace( /\s+/g, ' ' ).trim() ).toContain(
			'Best launchpad for a redesign.'
		);
		for ( const line of lines ) {
			expect( line.length ).toBeLessThanOrEqual( 40 );
		}
	} );

	it( 'preserves explicit newlines in labels and descriptions', () => {
		const lines = buildOptionPickerLines(
			[
				{
					value: 'a',
					label: '1. First line\nsecond label line',
					description: 'Para one.\nPara two.',
				},
			],
			'a',
			80
		).map( stripAnsi );
		expect( lines ).toEqual( [
			'→ 1. First line',
			'  second label line',
			'     Para one.',
			'     Para two.',
		] );
	} );

	it( 'keeps the descriptionless last item on the final line for the Other inline input', () => {
		const lines = buildOptionPickerLines( ITEMS, '__other__', 100 ).map( stripAnsi );
		expect( lines[ lines.length - 1 ] ).toBe( '→ Other (type my own)' );
	} );
} );
