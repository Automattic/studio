import { describe, it, expect } from 'vitest';
import { stripNoisyFields } from '../wpcom-tools';

describe( 'stripNoisyFields', () => {
	it( 'removes _links and other noisy top-level fields', () => {
		const input = {
			id: 1,
			title: 'Hello',
			_links: { self: '/posts/1' },
			_embedded: { author: [] },
			guid: { rendered: 'http://example.com/?p=1' },
			ping_status: 'open',
			comment_status: 'open',
			generated_slug: 'hello',
			permalink_template: 'http://example.com/%postname%/',
		};
		const { data, removed } = stripNoisyFields( input );
		expect( data ).toEqual( { id: 1, title: 'Hello' } );
		expect( removed ).toContain( '_links' );
		expect( removed ).toContain( 'guid' );
		expect( removed ).toContain( 'permalink_template' );
	} );

	it( 'drops rendered when raw is present in the same object', () => {
		const input = {
			title: { raw: 'Hello', rendered: '<p>Hello</p>' },
			content: { raw: '<!-- wp:paragraph -->', rendered: '<p>rendered html</p>' },
		};
		const { data, removed } = stripNoisyFields( input );
		expect( data ).toEqual( {
			title: { raw: 'Hello' },
			content: { raw: '<!-- wp:paragraph -->' },
		} );
		expect( removed ).toContain( 'rendered (raw exists)' );
	} );

	it( 'keeps rendered when raw is absent', () => {
		const input = { title: { rendered: 'Hello' } };
		const { data } = stripNoisyFields( input );
		expect( data ).toEqual( { title: { rendered: 'Hello' } } );
	} );

	it( 'recursively strips from arrays', () => {
		const input = [
			{ id: 1, _links: { self: '/1' }, title: { raw: 'A', rendered: '<p>A</p>' } },
			{ id: 2, _links: { self: '/2' }, title: { raw: 'B', rendered: '<p>B</p>' } },
		];
		const { data } = stripNoisyFields( input );
		expect( data ).toEqual( [
			{ id: 1, title: { raw: 'A' } },
			{ id: 2, title: { raw: 'B' } },
		] );
	} );

	it( 'passes through primitives unchanged', () => {
		expect( stripNoisyFields( 42 ).data ).toBe( 42 );
		expect( stripNoisyFields( 'hello' ).data ).toBe( 'hello' );
		expect( stripNoisyFields( null ).data ).toBe( null );
	} );
} );
