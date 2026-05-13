import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { fitSelectedWidgetToContentInEditor } from './editor-state';
import type { Editor } from 'tldraw';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'editor state widget fitting', () => {
	it( 'fits a note widget through the generic widget definition hook', async () => {
		const { editor, updates } = createEditorWithSelectedShape( {
			id: 'shape:note-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 20,
			index: 'a1',
			props: {
				widgetType: 'note',
				shapeProps: {
					w: 200,
					h: 200,
				},
				widgetProps: {
					text: '',
					tone: 'yellow',
				},
			},
		} as unknown as RectangleWidgetShape );

		await expect( fitSelectedWidgetToContentInEditor( editor ) ).resolves.toBe( true );

		expect( updates ).toHaveLength( 1 );
		expect( updates[ 0 ] ).toMatchObject( {
			id: 'shape:note-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 80,
			props: {
				shapeProps: {
					w: 200,
					h: 80,
				},
			},
		} );
	} );

	it( 'fits a media widget to natural image dimensions', async () => {
		class MockImage {
			naturalWidth = 1600;
			naturalHeight = 900;
			onload: ( ( event: Event ) => void ) | null = null;
			onerror: ( ( event: Event ) => void ) | null = null;

			set src( _url: string ) {
				queueMicrotask( () => this.onload?.( new Event( 'load' ) ) );
			}
		}
		vi.stubGlobal( 'Image', MockImage );

		const { editor, updates } = createEditorWithSelectedShape( {
			id: 'shape:media-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 20,
			index: 'a1',
			props: {
				widgetType: 'media',
				shapeProps: {
					w: 320,
					h: 320,
				},
				widgetProps: {
					url: 'https://example.com/image.jpg',
					mediaKind: 'image',
					alt: 'Example image',
					mediaId: 123,
				},
			},
		} as unknown as RectangleWidgetShape );

		await expect( fitSelectedWidgetToContentInEditor( editor ) ).resolves.toBe( true );

		expect( updates ).toHaveLength( 1 );
		expect( updates[ 0 ] ).toMatchObject( {
			id: 'shape:media-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 90,
			props: {
				shapeProps: {
					w: 320,
					h: 180,
				},
			},
		} );
	} );

	it( 'fits an embed widget to its embed definition dimensions', async () => {
		const { editor, updates } = createEditorWithSelectedShape( {
			id: 'shape:embed-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 20,
			index: 'a1',
			props: {
				widgetType: 'embed',
				shapeProps: {
					w: 360,
					h: 500,
				},
				widgetProps: {
					url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				},
			},
		} as unknown as RectangleWidgetShape );

		await expect( fitSelectedWidgetToContentInEditor( editor ) ).resolves.toBe( true );

		expect( updates ).toHaveLength( 1 );
		expect( updates[ 0 ] ).toMatchObject( {
			id: 'shape:embed-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 168.5,
			props: {
				shapeProps: {
					w: 360,
					h: 203,
				},
			},
		} );
	} );
} );

function createEditorWithSelectedShape( shape: RectangleWidgetShape ) {
	const updates: unknown[] = [];
	const editor = {
		isDisposed: false,
		getSelectedShapeIds: () => [ shape.id ],
		getShape: ( shapeId: string ) => ( shapeId === shape.id ? shape : undefined ),
		getCurrentPageShapes: () => [ shape ],
		updateShape: ( update: unknown ) => {
			updates.push( update );
		},
	} as unknown as Editor;

	return { editor, updates };
}
