import { describe, expect, it } from 'vitest';
import {
	getLocalMediaPath,
	getSafeMediaUrl,
	isRenderableMediaWidget,
	stripMediaWidgetPayloadLines,
} from '../chat-artifacts';

describe( 'stripMediaWidgetPayloadLines', () => {
	it( 'removes legacy payload marker lines and keeps the rest', () => {
		const text =
			'Screenshot captured — desktop: captured full page (1248px tall).\n' +
			'mediaWidgetPayload={"type":"media","widgetProps":{"url":"file:///tmp/s.jpg"}}';

		expect( stripMediaWidgetPayloadLines( text ) ).toBe(
			'Screenshot captured — desktop: captured full page (1248px tall).'
		);
	} );

	it( 'removes plural payload marker lines', () => {
		const text = 'line one\nmediaWidgetPayloads=[{"type":"media"}]\nline two';

		expect( stripMediaWidgetPayloadLines( text ) ).toBe( 'line one\nline two' );
	} );

	it( 'returns text without markers unchanged', () => {
		expect( stripMediaWidgetPayloadLines( 'plain output\nsecond line' ) ).toBe(
			'plain output\nsecond line'
		);
	} );
} );

describe( 'media widget helpers', () => {
	const localWidget = {
		type: 'media',
		widgetProps: {
			mediaKind: 'image',
			url: 'file:///tmp/screenshot.jpg',
			source: { type: 'local', path: '/tmp/screenshot.jpg' },
		},
	};

	it( 'extracts local paths only from valid local sources', () => {
		expect( getLocalMediaPath( localWidget ) ).toBe( '/tmp/screenshot.jpg' );
		expect( getLocalMediaPath( { type: 'media', widgetProps: {} } ) ).toBeNull();
		expect(
			getLocalMediaPath( { type: 'media', widgetProps: { source: { type: 'remote' } } } )
		).toBeNull();
	} );

	it( 'accepts only http, https, and data urls', () => {
		const widget = ( url: unknown ) => ( { type: 'media', widgetProps: { url } } );
		expect( getSafeMediaUrl( widget( 'https://example.com/a.png' ) ) ).toBe(
			'https://example.com/a.png'
		);
		expect( getSafeMediaUrl( widget( 'file:///tmp/a.png' ) ) ).toBeNull();
		expect( getSafeMediaUrl( widget( 'not a url' ) ) ).toBeNull();
		expect( getSafeMediaUrl( widget( undefined ) ) ).toBeNull();
	} );

	it( 'treats only image media widgets with a usable source as renderable', () => {
		expect( isRenderableMediaWidget( localWidget ) ).toBe( true );
		expect(
			isRenderableMediaWidget( { type: 'site-preview', widgetProps: { mediaKind: 'image' } } )
		).toBe( false );
		expect(
			isRenderableMediaWidget( { type: 'media', widgetProps: { mediaKind: 'video' } } )
		).toBe( false );
		expect(
			isRenderableMediaWidget( { type: 'media', widgetProps: { mediaKind: 'image' } } )
		).toBe( false );
	} );
} );
