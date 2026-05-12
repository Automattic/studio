import { describe, expect, it, vi } from 'vitest';
import {
	createUrlPastePayload,
	doesPasteMatchAccept,
	getWidgetPasteHandler,
} from './paste-handlers';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

vi.mock( '@/data/wordpress/media', () => ( {
	uploadSiteMedia: vi.fn(),
} ) );

describe( 'widget paste handlers', () => {
	it( 'creates URL paste payloads for http URLs', () => {
		expect( createUrlPastePayload( 'https://example.com/path' ) ).toEqual( {
			kind: 'url',
			text: 'https://example.com/path',
			url: 'https://example.com/path',
		} );
	} );

	it( 'does not create URL paste payloads for bare hostnames, unsupported protocols, or free text', () => {
		expect( createUrlPastePayload( 'example.com' ) ).toBeNull();
		expect( createUrlPastePayload( 'ftp://example.com/file.zip' ) ).toBeNull();
		expect( createUrlPastePayload( 'not a url' ) ).toBeNull();
	} );

	it( 'matches bookmark paste handlers for supported URLs', () => {
		const payload = createUrlPastePayload( 'https://example.com/' );

		if ( ! payload ) {
			throw new Error( 'Expected a URL paste payload.' );
		}

		expect( getWidgetPasteHandler( payload ) ).toMatchObject( {
			definition: { type: 'bookmark' },
			handler: { id: 'bookmark-url' },
		} );
	} );

	it( 'matches embed paste handlers before bookmark handlers for embeddable URLs', () => {
		const payload = createUrlPastePayload( 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' );

		if ( ! payload ) {
			throw new Error( 'Expected a URL paste payload.' );
		}

		expect( getWidgetPasteHandler( payload ) ).toMatchObject( {
			definition: { type: 'embed' },
			handler: { id: 'embed-url' },
		} );
	} );

	it( 'supports paste protocol matching', () => {
		const payload = createUrlPastePayload( 'https://example.com/' );

		if ( ! payload ) {
			throw new Error( 'Expected a URL paste payload.' );
		}

		expect( doesPasteMatchAccept( payload, { protocols: [ 'https' ] } ) ).toBe( true );
		expect( doesPasteMatchAccept( payload, { protocols: [ 'http:' ] } ) ).toBe( false );
	} );

	it( 'creates bookmark widget props from the URL paste handler', async () => {
		const payload = createUrlPastePayload( 'https://example.com/' );
		const match = payload ? getWidgetPasteHandler( payload ) : null;

		const result = payload ? await match?.handler.handle( payload, { siteId: 'site-1' } ) : null;

		expect( result ).toEqual( {
			widgetProps: {
				url: 'https://example.com/',
			},
			shouldStartEditing: false,
		} );
	} );

	it( 'creates embed widget props from the URL paste handler', async () => {
		const payload = createUrlPastePayload( 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' );
		const match = payload ? getWidgetPasteHandler( payload ) : null;

		const result = payload ? await match?.handler.handle( payload, { siteId: 'site-1' } ) : null;

		expect( result ).toEqual( {
			shapeProps: {
				w: 800,
				h: 450,
			},
			widgetProps: {
				url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			},
			shouldStartEditing: false,
		} );
	} );
} );
