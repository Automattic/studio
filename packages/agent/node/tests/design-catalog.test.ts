import { readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { designCatalog, drawDesign } from '@studio/agent/shared/design-catalog';

describe( 'the design catalogs', () => {
	it.each( [ 'directions', 'layouts' ] as const )( 'read every %s file as an entry', ( kind ) => {
		const files = readdirSync( path.join( __dirname, '../../shared/design-catalog', kind ) ).filter(
			( file ) => file.endsWith( '.md' ) && file !== 'README.md'
		);
		const entries = designCatalog( kind );
		expect( entries ).toHaveLength( files.length );
		for ( const entry of entries ) {
			expect( entry.name && entry.description && entry.details ).toBeTruthy();
			expect( entry.details ).not.toMatch( /^Avoid/m );
		}
	} );

	it( 'draws different looks and any layout, from the first entry to the last', () => {
		const [ looks, layouts ] = [ designCatalog( 'directions' ), designCatalog( 'layouts' ) ];
		expect( drawDesign( () => 0 ) ).toEqual( {
			looks: looks.slice( 0, 3 ),
			layout: layouts[ 0 ],
		} );
		expect( drawDesign( () => 0.9999 ) ).toEqual( {
			looks: looks.slice( -3 ).reverse(),
			layout: layouts.at( -1 ),
		} );
	} );
} );
