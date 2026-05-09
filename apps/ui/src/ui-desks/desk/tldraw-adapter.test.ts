import { describe, expect, it, vi } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	deskWidgetToCanvasShape,
} from './tldraw-adapter';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { TLShape } from 'tldraw';

vi.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'tldraw adapter', () => {
	it( 'maps a desk note widget to a canvas shape', () => {
		const widget: NoteWidget = {
			id: 'note-1',
			type: 'note',
			x: 10,
			y: 20,
			zIndex: 'a1',
			shapeProps: {
				w: 260,
				h: 220,
			},
			widgetProps: {
				text: 'Hello',
				tone: 'yellow',
			},
		};

		expect( deskWidgetToCanvasShape( widget ) ).toMatchObject( {
			id: 'shape:note-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 10,
			y: 20,
			index: 'a1',
			props: {
				widgetType: 'note',
				shapeProps: {
					w: 260,
					h: 220,
				},
				widgetProps: {
					text: 'Hello',
					tone: 'yellow',
				},
			},
		} );
	} );

	it( 'maps a canvas note shape back to a desk widget', () => {
		const shape = {
			id: 'shape:note-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 30,
			y: 40,
			rotation: 0,
			index: 'a2',
			props: {
				widgetType: 'note',
				shapeProps: {
					w: 300,
					h: 240,
				},
				widgetProps: {
					text: 'Updated',
					tone: 'blue',
				},
			},
		} as unknown as TLShape;

		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			id: 'note-1',
			type: 'note',
			x: 30,
			y: 40,
			rotation: undefined,
			zIndex: 'a2',
			shapeProps: {
				w: 300,
				h: 240,
			},
			widgetProps: {
				text: 'Updated',
				tone: 'blue',
			},
		} );
	} );

	it( 'maps a post widget through the canvas shape adapter', () => {
		const widget: PostWidget = {
			id: 'post-1',
			type: 'post',
			x: 40,
			y: 50,
			zIndex: 'a3',
			shapeProps: {
				w: 280,
				h: 360,
			},
			widgetProps: {
				postId: 42,
			},
		};

		const shape = deskWidgetToCanvasShape( widget ) as TLShape;

		expect( shape ).toMatchObject( {
			id: 'shape:post-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 40,
			y: 50,
			index: 'a3',
			props: {
				widgetType: 'post',
				shapeProps: {
					w: 280,
					h: 360,
				},
				widgetProps: {
					postId: 42,
				},
			},
		} );
		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			...widget,
			rotation: undefined,
		} );
	} );

	it( 'ignores unsupported canvas shapes', () => {
		const shape = {
			id: 'shape:geo-1',
			type: 'geo',
			x: 0,
			y: 0,
			rotation: 0,
			index: 'a3',
			props: {},
		} as unknown as TLShape;

		expect( canvasShapeToDeskWidget( shape ) ).toBeNull();
	} );

	it( 'maps a canvas camera to a desk viewport', () => {
		expect(
			canvasCameraToDeskViewport( {
				x: -120,
				y: 80,
				z: 1.5,
			} )
		).toEqual( {
			x: -120,
			y: 80,
			z: 1.5,
		} );
	} );
} );
