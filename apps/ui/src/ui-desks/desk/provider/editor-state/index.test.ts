import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	deskWidgetToCanvasShape,
	resolvedDeskWidgetToCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	fitSelectedWidgetToContentInEditor,
	getCurrentSelectedWidgetToolbarItem,
	isTemporaryDeskVisibleInEditor,
	removeSelectedWidgetFromEditor,
	toggleTemporaryDeskInEditor,
} from './index';
import type { ColorWidget } from '@/ui-desks/widgets/color/types';
import type { DeskWidget, ResolvedDeskWidget } from '@/ui-desks/widgets/types';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

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

describe( 'editor state widget removal', () => {
	it( 'allows toolbar removal for a complete derived post collection stack selection', () => {
		const { editor } = createEditorWithPostCollectionDerivedSelection();

		const item = getCurrentSelectedWidgetToolbarItem( editor );

		expect( item ).toMatchObject( {
			kind: 'single-widget',
			canRemove: true,
			widget: {
				id: 'collection-1',
				type: 'post-collection',
			},
		} );
	} );

	it( 'removes the selected derived post collection stack members from the toolbar', () => {
		const { editor, derivedShapes, deletedShapeIds } =
			createEditorWithPostCollectionDerivedSelection();

		expect( removeSelectedWidgetFromEditor( editor ) ).toBe( true );
		expect( deletedShapeIds ).toEqual( [ derivedShapes.map( ( shape ) => shape.id ) ] );
	} );

	it( 'keeps toolbar removal disabled when a complete derived selection cannot be removed', () => {
		const { editor } = createEditorWithPostCollectionDerivedSelection();

		const item = getCurrentSelectedWidgetToolbarItem( editor, { canRemove: false } );

		expect( item ).toMatchObject( {
			kind: 'single-widget',
			canRemove: false,
		} );
	} );
} );

describe( 'editor state temporary desks', () => {
	it( 'toggles temporary widgets, stacks, and connectors without changing the source widget', () => {
		const sourceShape = deskWidgetToCanvasShape( {
			id: 'styles-1',
			type: 'theme-styles',
			x: 100,
			y: 120,
			zIndex: 'a1',
			shapeProps: {
				w: 220,
				h: 160,
			},
			widgetProps: {
				palette: [],
				fontFamily: 'system-ui, sans-serif',
				textColor: '#111111',
				backgroundColor: '#ffffff',
			},
		} as DeskWidget ) as TLShape;
		const { editor, bindings } = createTemporaryDeskEditor( [ sourceShape ] );

		expect(
			toggleTemporaryDeskInEditor( editor, {
				id: 'palette-1',
				sourceWidgetId: 'styles-1',
				followSource: true,
				widgets: [ createColorWidget() ],
				stacks: [
					{
						id: 'palette-stack',
						x: 360,
						y: 200,
						zIndex: 'a2',
						memberIds: [ 'color-1' ],
						viewMode: 'circle',
					},
				],
				connectors: [
					{
						id: 'styles-to-palette',
						from: {
							widgetId: 'styles-1',
							normalizedAnchor: { x: 0.5, y: 0.5 },
						},
						to: {
							widgetId: 'color-1',
							normalizedAnchor: { x: 0.5, y: 0.5 },
						},
						appearance: {
							dash: 'solid',
							arrowheadStart: 'none',
							arrowheadEnd: 'none',
						},
					},
				],
			} )
		).toBe( true );

		expect( isTemporaryDeskVisibleInEditor( editor, 'palette-1' ) ).toBe( true );
		expect( editor.getShape( 'shape:color-1' as TLShapeId ) ).toMatchObject( {
			meta: {
				studioDeskTemporaryId: 'palette-1',
				studioDeskFollowSourceWidgetId: 'styles-1',
				deskStackViewMode: null,
				deskStackOpenViewMode: 'circle',
			},
		} );
		expect( editor.getShape( 'shape:connector:styles-to-palette' as TLShapeId ) ).toMatchObject( {
			props: {
				dash: 'solid',
				arrowheadStart: 'none',
				arrowheadEnd: 'none',
			},
		} );
		expect( bindings ).toHaveLength( 2 );

		expect( toggleTemporaryDeskInEditor( editor, { id: 'palette-1', widgets: [] } ) ).toBe( true );
		expect( isTemporaryDeskVisibleInEditor( editor, 'palette-1' ) ).toBe( false );
		expect( editor.getCurrentPageShapes() ).toEqual( [ sourceShape ] );
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

function createEditorWithPostCollectionDerivedSelection() {
	const sourceShape = deskWidgetToCanvasShape( {
		id: 'collection-1',
		type: 'post-collection',
		x: 40,
		y: 50,
		zIndex: 'a1',
		shapeProps: {
			w: 1,
			h: 1,
		},
		widgetProps: {
			query: {
				postType: 'post',
				perPage: 5,
				status: 'publish',
				orderby: 'date',
				order: 'desc',
			},
		},
	} as DeskWidget ) as TLShape;
	const stack = {
		id: 'post-collection:collection-1',
		x: 40,
		y: 50,
		zIndex: 'a1',
		memberIds: [ 'collection-1:post:41', 'collection-1:post:42' ],
	};
	const derivedShapes = [ 41, 42 ].map(
		( postId, order ) =>
			resolvedDeskWidgetToCanvasShape(
				{
					origin: {
						kind: 'derived',
						sourceWidgetId: 'collection-1',
						key: `post:${ postId }`,
					},
					widget: {
						id: `collection-1:post:${ postId }`,
						type: 'post',
						x: 40,
						y: 50,
						zIndex: `a${ order + 2 }`,
						shapeProps: {
							w: 280,
							h: 380,
						},
						widgetProps: {
							postId,
						},
					},
				} as ResolvedDeskWidget< DeskWidget >,
				{ stack, order }
			) as TLShape
	);
	const shapes = [ sourceShape, ...derivedShapes ];
	const selectedShapeIds = derivedShapes.map( ( shape ) => shape.id );
	const deletedShapeIds: TLShapeId[][] = [];
	const editor = {
		isDisposed: false,
		getSelectedShapeIds: () => selectedShapeIds,
		getShape: ( shapeId: TLShapeId ) => shapes.find( ( shape ) => shape.id === shapeId ),
		getCurrentPageShapes: () => shapes,
		deleteShapes: ( shapeIds: TLShapeId[] ) => {
			deletedShapeIds.push( shapeIds );
		},
	} as unknown as Editor;

	return { editor, derivedShapes, deletedShapeIds };
}

function createTemporaryDeskEditor( initialShapes: TLShape[] ) {
	const shapes = [ ...initialShapes ];
	const bindings: unknown[] = [];
	const editor = {
		getCurrentPageShapes: () => shapes,
		getShape: ( shapeId: TLShapeId ) => shapes.find( ( shape ) => shape.id === shapeId ),
		createShapes: ( partials: TLShape[] ) => {
			shapes.push( ...partials );
		},
		createBindings: ( nextBindings: unknown[] ) => {
			bindings.push( ...nextBindings );
		},
		deleteShapes: ( shapeIds: TLShapeId[] ) => {
			for ( const shapeId of shapeIds ) {
				const index = shapes.findIndex( ( shape ) => shape.id === shapeId );
				if ( index !== -1 ) {
					shapes.splice( index, 1 );
				}
			}
		},
		focus: vi.fn(),
	} as unknown as Editor;

	return { editor, bindings };
}

function createColorWidget(): ColorWidget {
	return {
		id: 'color-1',
		type: 'color',
		x: 360,
		y: 200,
		zIndex: 'a2',
		shapeProps: {
			w: 140,
			h: 140,
		},
		widgetProps: {
			color: '#3858e9',
			title: 'Primary',
		},
	};
}
