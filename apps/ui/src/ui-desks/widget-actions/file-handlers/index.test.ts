import { describe, expect, it, vi } from 'vitest';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { doesFileMatchAccept, getWidgetFileHandler } from './index';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

vi.mock( '@/data/wordpress/media', () => ( {
	uploadSiteMedia: vi.fn(),
} ) );

describe( 'widget file handlers', () => {
	it( 'matches media uploads for image and video files when the site is running', () => {
		const image = new File( [ 'image' ], 'photo.png', { type: 'image/png' } );
		const video = new File( [ 'video' ], 'clip.mp4', { type: 'video/mp4' } );

		expect( getWidgetFileHandler( image, { isRunningSite: true } ) ).toMatchObject( {
			definition: { type: 'media' },
			handler: { id: 'media-upload' },
		} );
		expect( getWidgetFileHandler( video, { isRunningSite: true } ) ).toMatchObject( {
			definition: { type: 'media' },
			handler: { id: 'media-upload' },
		} );
	} );

	it( 'does not match handlers that require a running site when the site is stopped', () => {
		const image = new File( [ 'image' ], 'photo.png', { type: 'image/png' } );

		expect( getWidgetFileHandler( image, { isRunningSite: false } ) ).toBeNull();
	} );

	it( 'supports exact MIME types, MIME wildcards, and extensions', () => {
		expect(
			doesFileMatchAccept( new File( [ 'image' ], 'PHOTO.PNG', { type: 'image/png' } ), {
				mimeTypes: [ 'image/*' ],
			} )
		).toBe( true );
		expect(
			doesFileMatchAccept( new File( [ 'markdown' ], 'README.MD', { type: '' } ), {
				extensions: [ 'md' ],
			} )
		).toBe( true );
		expect(
			doesFileMatchAccept( new File( [ 'text' ], 'notes.txt', { type: 'text/plain' } ), {
				mimeTypes: [ 'text/markdown' ],
				extensions: [ '.md' ],
			} )
		).toBe( false );
	} );

	it( 'creates uploaded media widget props from the media file handler', async () => {
		const video = new File( [ 'video' ], 'clip.mp4', { type: 'video/mp4' } );
		const match = getWidgetFileHandler( video, { isRunningSite: true } );
		vi.mocked( uploadSiteMedia ).mockResolvedValueOnce( {
			id: 123,
			source_url: 'https://example.com/clip.mp4',
			alt_text: '',
		} as Awaited< ReturnType< typeof uploadSiteMedia > > );

		const result = await match?.handler.handle( video, { siteId: 'site-1' } );

		expect( result ).toMatchObject( {
			widgetProps: {
				url: 'https://example.com/clip.mp4',
				mediaKind: 'video',
				alt: 'clip.mp4',
				mediaId: 123,
			},
			shouldStartEditing: false,
		} );
	} );
} );
