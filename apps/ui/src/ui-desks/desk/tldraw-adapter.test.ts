import { sortByIndex, type TLShape, type TLShapePartial } from 'tldraw';
import { describe, expect, it, vi } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	canvasShapesToDeskStacks,
	deskConfigToCanvasShapes,
	deskWidgetToCanvasShape,
	getDeskCanvasRecordMetaWithResolutionState,
	getDeskCanvasRecordResolutionState,
	hasOnlyDeskCanvasRecordResolutionStateChange,
	isPersistentDeskCanvasShape,
	resolvedDeskWidgetToCanvasShape,
} from './tldraw-adapter';
import type { DeskConfig } from './types';
import type { MediaWidget } from '@/ui-desks/widgets/media/types';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PageWidget } from '@/ui-desks/widgets/page/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { SitePreviewWidget } from '@/ui-desks/widgets/site-preview/types';
import type { ResolvedDeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
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
				h: 380,
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
					h: 380,
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

	it( 'maps a page widget through the canvas shape adapter', () => {
		const widget: PageWidget = {
			id: 'page-1',
			type: 'page',
			x: 60,
			y: 70,
			zIndex: 'a4',
			shapeProps: {
				w: 280,
				h: 380,
			},
			widgetProps: {
				pageId: 84,
				tone: 'violet',
			},
		};

		const shape = deskWidgetToCanvasShape( widget ) as TLShape;

		expect( shape ).toMatchObject( {
			id: 'shape:page-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 60,
			y: 70,
			index: 'a4',
			props: {
				widgetType: 'page',
				shapeProps: {
					w: 280,
					h: 380,
				},
				widgetProps: {
					pageId: 84,
					tone: 'violet',
				},
			},
		} );
		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			...widget,
			rotation: undefined,
		} );
	} );

	it( 'maps a site preview widget through the canvas shape adapter', () => {
		const widget: SitePreviewWidget = {
			id: 'site-preview-1',
			type: 'site-preview',
			x: 80,
			y: 90,
			zIndex: 'a5',
			shapeProps: {
				w: 480,
				h: 360,
			},
			widgetProps: {
				path: '/',
			},
		};

		const shape = deskWidgetToCanvasShape( widget ) as TLShape;

		expect( shape ).toMatchObject( {
			id: 'shape:site-preview-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 80,
			y: 90,
			index: 'a5',
			props: {
				widgetType: 'site-preview',
				shapeProps: {
					w: 480,
					h: 360,
				},
				widgetProps: {
					path: '/',
				},
			},
		} );
		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			...widget,
			rotation: undefined,
		} );
	} );

	it( 'maps a media widget through the canvas shape adapter', () => {
		const widget: MediaWidget = {
			id: 'media-1',
			type: 'media',
			x: 100,
			y: 110,
			zIndex: 'a6',
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
		};

		const shape = deskWidgetToCanvasShape( widget ) as TLShape;

		expect( shape ).toMatchObject( {
			id: 'shape:media-1',
			type: RECTANGLE_WIDGET_SHAPE_TYPE,
			x: 100,
			y: 110,
			index: 'a6',
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
		} );
		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			...widget,
			rotation: undefined,
		} );
	} );

	it( 'projects stacked widgets from the stack position', () => {
		const desk: DeskConfig = {
			version: 1,
			updatedAt: '2026-05-09T00:00:00.000Z',
			widgets: [
				{
					...createNoteWidget(),
					id: 'note-1',
					x: 10,
					y: 20,
				},
				{
					...createNoteWidget(),
					id: 'note-2',
					x: 30,
					y: 40,
					zIndex: 'a3',
				},
				{
					...createNoteWidget(),
					id: 'note-3',
					zIndex: 'a4.999',
				},
			],
			stacks: [
				{
					id: 'stack-1',
					x: 100,
					y: 200,
					zIndex: 'a5',
					memberIds: [ 'note-1', 'note-2' ],
				},
			],
		};

		const shapes = deskConfigToCanvasShapes( desk );
		const firstStackMember = getCanvasShape( shapes, 'shape:note-1' );
		const secondStackMember = getCanvasShape( shapes, 'shape:note-2' );

		expect( firstStackMember ).toMatchObject( {
			id: 'shape:note-1',
			x: 100,
			y: 200,
			rotation: 0,
			meta: {
				deskStackId: 'stack-1',
				deskStackOrder: 0,
				deskStackOriginalZIndex: 'a1',
			},
		} );
		expect( secondStackMember ).toMatchObject( {
			id: 'shape:note-2',
			x: 110,
			y: 208,
			rotation: 0.052,
			meta: {
				deskStackId: 'stack-1',
				deskStackOrder: 1,
				deskStackOriginalZIndex: 'a3',
			},
		} );
		expect( sortByIndex( secondStackMember, firstStackMember ) ).toBeLessThan( 0 );
		expect( getSortedCanvasShapeIds( shapes ) ).toEqual( [
			'shape:note-3',
			'shape:note-2',
			'shape:note-1',
		] );
	} );

	it( 'persists a stacked widget original z-index instead of the stack z-index', () => {
		const shape = {
			...deskWidgetToCanvasShape( createNoteWidget( 'note-1' ) ),
			index: 'a8',
			meta: {
				deskStackId: 'stack-1',
				deskStackOrder: 0,
				deskStackOriginalZIndex: 'a2',
			},
		} as unknown as TLShape;

		expect( canvasShapeToDeskWidget( shape ) ).toMatchObject( {
			id: 'note-1',
			zIndex: 'a2',
		} );
	} );

	it( 'extracts stacks from canvas shape metadata', () => {
		const shapes = [
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-1' ) ),
				x: 100,
				y: 200,
				index: 'a5',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 0,
				},
			},
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-2' ) ),
				x: 110,
				y: 208,
				index: 'a4.999',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 1,
				},
			},
		] as unknown as TLShape[];

		expect( canvasShapesToDeskStacks( shapes ) ).toEqual( [
			{
				id: 'stack-1',
				x: 100,
				y: 200,
				zIndex: 'a5',
				memberIds: [ 'note-1', 'note-2' ],
			},
		] );
	} );

	it( 'extracts collapsed stack geometry while a stack is expanded', () => {
		const shapes = [
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-1' ) ),
				x: -120,
				y: 240,
				index: 'a5',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 0,
					deskStackExpanded: true,
					deskStackHomeX: 100,
					deskStackHomeY: 200,
					deskStackHomeZIndex: 'a7',
				},
			},
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-2' ) ),
				x: 220,
				y: 240,
				index: 'a4.999',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 1,
					deskStackExpanded: true,
					deskStackHomeX: 100,
					deskStackHomeY: 200,
					deskStackHomeZIndex: 'a7',
				},
			},
		] as unknown as TLShape[];

		expect( canvasShapesToDeskStacks( shapes ) ).toEqual( [
			{
				id: 'stack-1',
				x: 100,
				y: 200,
				zIndex: 'a7',
				memberIds: [ 'note-1', 'note-2' ],
			},
		] );
	} );

	it( 'extracts widget geometry from pre-push origins', () => {
		const shape = {
			...deskWidgetToCanvasShape( createNoteWidget( 'note-1' ) ),
			x: 320,
			y: 420,
			meta: {
				deskStackPushedBy: 'stack-1',
				deskStackPushOriginX: 30,
				deskStackPushOriginY: 40,
			},
		} as unknown as TLShape;

		expect( canvasShapeToDeskWidget( shape ) ).toMatchObject( {
			id: 'note-1',
			x: 30,
			y: 40,
		} );
	} );

	it( 'extracts stack geometry from pre-push origins', () => {
		const shapes = [
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-1' ) ),
				x: 320,
				y: 420,
				index: 'a5',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 0,
					deskStackPushedBy: 'stack-2',
					deskStackPushOriginX: 100,
					deskStackPushOriginY: 200,
				},
			},
			{
				...deskWidgetToCanvasShape( createNoteWidget( 'note-2' ) ),
				x: 330,
				y: 428,
				index: 'a4.999',
				meta: {
					deskStackId: 'stack-1',
					deskStackOrder: 1,
					deskStackPushedBy: 'stack-2',
					deskStackPushOriginX: 110,
					deskStackPushOriginY: 208,
				},
			},
		] as unknown as TLShape[];

		expect( canvasShapesToDeskStacks( shapes ) ).toEqual( [
			{
				id: 'stack-1',
				x: 100,
				y: 200,
				zIndex: 'a5',
				memberIds: [ 'note-1', 'note-2' ],
			},
		] );
	} );

	it( 'marks derived widgets as non-persistent canvas shapes', () => {
		const resolvedWidget: ResolvedDeskWidget< PostWidget > = {
			origin: {
				kind: 'derived',
				sourceWidgetId: 'collection-1',
				key: 'post:42',
			},
			widget: {
				id: 'collection-1:post:42',
				type: 'post',
				x: 40,
				y: 50,
				zIndex: 'a3',
				shapeProps: {
					w: 280,
					h: 380,
				},
				widgetProps: {
					postId: 42,
				},
			},
		};

		const shape = resolvedDeskWidgetToCanvasShape( resolvedWidget ) as TLShape;

		expect( shape ).toMatchObject( {
			id: 'shape:collection-1:post:42',
			meta: {
				studioDeskOrigin: 'derived',
				studioDeskPersist: false,
				studioDeskSourceWidgetId: 'collection-1',
				studioDeskDerivedKey: 'post:42',
			},
		} );
		expect( isPersistentDeskCanvasShape( shape ) ).toBe( false );
		expect( canvasShapeToDeskWidget( shape ) ).toEqual( {
			...resolvedWidget.widget,
			rotation: undefined,
		} );
	} );

	it( 'reads loading resolution state from canvas metadata', () => {
		const shape = {
			meta: getDeskCanvasRecordMetaWithResolutionState( {}, 'loading' ),
		};

		expect( getDeskCanvasRecordResolutionState( shape ) ).toBe( 'loading' );
		expect(
			getDeskCanvasRecordResolutionState( {
				meta: getDeskCanvasRecordMetaWithResolutionState( shape ),
			} )
		).toBeUndefined();
	} );

	it( 'detects resolution state-only canvas metadata changes', () => {
		const shape = {
			id: 'shape:post-collection-1',
			x: 40,
			y: 50,
			meta: {},
		};
		const loadingShape = {
			...shape,
			meta: getDeskCanvasRecordMetaWithResolutionState( shape, 'loading' ),
		};

		expect( hasOnlyDeskCanvasRecordResolutionStateChange( shape, loadingShape ) ).toBe( true );
		expect(
			hasOnlyDeskCanvasRecordResolutionStateChange( shape, {
				...loadingShape,
				x: 41,
			} )
		).toBe( false );
	} );

	it( 'maps derived stack members through stack metadata', () => {
		const resolvedWidget: ResolvedDeskWidget< PostWidget > = {
			origin: {
				kind: 'derived',
				sourceWidgetId: 'collection-1',
				key: 'post:42',
			},
			widget: {
				id: 'collection-1:post:42',
				type: 'post',
				x: 40,
				y: 50,
				zIndex: 'a3',
				shapeProps: {
					w: 280,
					h: 380,
				},
				widgetProps: {
					postId: 42,
				},
			},
		};

		const shape = resolvedDeskWidgetToCanvasShape( resolvedWidget, {
			stack: {
				id: 'stack-1',
				x: 100,
				y: 200,
				zIndex: 'a7',
				memberIds: [ 'collection-1:post:41', 'collection-1:post:42' ],
			},
			order: 1,
		} ) as TLShape;

		expect( shape ).toMatchObject( {
			x: 110,
			y: 208,
			rotation: 0.052,
			index: 'a6.999',
			meta: {
				deskStackId: 'stack-1',
				deskStackOrder: 1,
				deskStackOriginalZIndex: 'a3',
				studioDeskOrigin: 'derived',
				studioDeskPersist: false,
				studioDeskSourceWidgetId: 'collection-1',
				studioDeskDerivedKey: 'post:42',
			},
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

function createNoteWidget( id = 'note-1' ): NoteWidget {
	return {
		id,
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
}

function getCanvasShape( shapes: TLShapePartial[], id: string ) {
	const shape = shapes.find( ( item ) => item.id === id );
	if ( ! shape || ! shape.index ) {
		throw new Error( `Expected canvas shape ${ id } with an index.` );
	}

	return shape as TLShapePartial & { index: string };
}

function getSortedCanvasShapeIds( shapes: TLShapePartial[] ) {
	return shapes
		.filter( ( shape ): shape is TLShapePartial & { id: string; index: string } =>
			Boolean( shape.id && shape.index )
		)
		.sort( sortByIndex )
		.map( ( shape ) => shape.id );
}
