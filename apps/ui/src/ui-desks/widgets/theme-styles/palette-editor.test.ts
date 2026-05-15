import { describe, expect, it, vi } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import { getStackId } from '@/ui-desks/stacks/utils';
import { COLOR_WIDGET_TYPE } from '@/ui-desks/widgets/color/types';
import {
	moveThemeStylesPaletteWithShapeInEditor,
	toggleThemeStylesPaletteInEditor,
} from './palette-editor';
import { THEME_STYLES_WIDGET_TYPE, type ThemeStylesWidget } from './types';
import type { Editor, TLShape, TLShapeId, TLShapePartial } from 'tldraw';

describe( 'theme styles palette editor behavior', () => {
	it( 'creates and removes a connected color stack for the selected styles shape', () => {
		const sourceWidget = createThemeStylesWidget();
		const sourceShape = createThemeStylesShape( sourceWidget );
		const editor = createMockEditor( [ sourceShape ] );

		expect( toggleThemeStylesPaletteInEditor( editor, sourceShape, sourceWidget ) ).toBe( true );

		const updatedSourceShape = editor.getShape( sourceShape.id ) as TLShape;
		const stackId = ( updatedSourceShape.meta as { paletteStackId?: string } ).paletteStackId;
		const colorShapes = editor
			.getCurrentPageShapes()
			.filter(
				( shape ) => ( shape.props as { widgetType?: unknown } ).widgetType === COLOR_WIDGET_TYPE
			);
		const arrows = editor.getCurrentPageShapes().filter( ( shape ) => shape.type === 'arrow' );

		expect( stackId ).toBeTruthy();
		expect( colorShapes ).toHaveLength( 2 );
		expect( colorShapes.map( getStackId ) ).toEqual( [ stackId, stackId ] );
		expect( colorShapes[ 0 ].meta ).toMatchObject( {
			studioDeskOrigin: 'derived',
			studioDeskPersist: false,
		} );
		expect( arrows ).toHaveLength( 1 );
		expect( arrows[ 0 ].meta ).toMatchObject( {
			studioDeskOrigin: 'derived',
			studioDeskPersist: false,
			stylesPaletteLink: true,
			linkedStackId: stackId,
		} );

		expect(
			toggleThemeStylesPaletteInEditor(
				editor,
				updatedSourceShape,
				getThemeStylesWidgetFromShape( updatedSourceShape )
			)
		).toBe( true );

		expect(
			editor
				.getCurrentPageShapes()
				.filter(
					( shape ) => ( shape.props as { widgetType?: unknown } ).widgetType === COLOR_WIDGET_TYPE
				)
		).toHaveLength( 0 );
		expect(
			editor.getCurrentPageShapes().filter( ( shape ) => shape.type === 'arrow' )
		).toHaveLength( 0 );
		expect( editor.getShape( sourceShape.id )?.meta ).toMatchObject( {
			paletteStackId: null,
		} );
	} );

	it( 'moves linked color stack members when the styles shape is dragged', () => {
		const sourceWidget = createThemeStylesWidget();
		const sourceShape = createThemeStylesShape( sourceWidget );
		const editor = createMockEditor( [ sourceShape ] );

		toggleThemeStylesPaletteInEditor( editor, sourceShape, sourceWidget );
		const updatedSourceShape = editor.getShape( sourceShape.id ) as TLShape;
		const updatedSourceWidget = getThemeStylesWidgetFromShape( updatedSourceShape );
		const colorShape = editor
			.getCurrentPageShapes()
			.find(
				( shape ) => ( shape.props as { widgetType?: unknown } ).widgetType === COLOR_WIDGET_TYPE
			) as TLShape;
		const origin = { x: colorShape.x, y: colorShape.y };

		moveThemeStylesPaletteWithShapeInEditor(
			editor,
			updatedSourceShape,
			{
				...updatedSourceShape,
				x: updatedSourceShape.x + 24,
				y: updatedSourceShape.y + 12,
			},
			updatedSourceWidget
		);

		expect( editor.getShape( colorShape.id ) ).toMatchObject( {
			x: origin.x + 24,
			y: origin.y + 12,
		} );
	} );
} );

function createThemeStylesWidget(): ThemeStylesWidget {
	return {
		id: 'styles-1',
		type: THEME_STYLES_WIDGET_TYPE,
		x: 100,
		y: 120,
		zIndex: 'a1',
		shapeProps: {
			w: 220,
			h: 160,
		},
		widgetProps: {
			palette: [
				{ slug: 'background', color: '#ffffff' },
				{ slug: 'primary', name: 'Primary', color: '#3858e9' },
				{ slug: 'accent', name: 'Accent', color: '#f97316' },
			],
			fontFamily: 'Inter, sans-serif',
			textColor: '#111111',
			backgroundColor: '#ffffff',
		},
	};
}

function createThemeStylesShape( widget: ThemeStylesWidget ): TLShape {
	return {
		id: `shape:${ widget.id }` as TLShapeId,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: widget.x,
		y: widget.y,
		rotation: 0,
		index: widget.zIndex as TLShape[ 'index' ],
		props: {
			widgetType: widget.type,
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
		},
		meta: {},
	} as TLShape;
}

function getThemeStylesWidgetFromShape( shape: TLShape ): ThemeStylesWidget {
	const props = shape.props as {
		shapeProps: ThemeStylesWidget[ 'shapeProps' ];
		widgetProps: ThemeStylesWidget[ 'widgetProps' ];
	};
	return {
		id: String( shape.id ).replace( /^shape:/, '' ),
		type: THEME_STYLES_WIDGET_TYPE,
		x: shape.x,
		y: shape.y,
		zIndex: shape.index,
		shapeProps: props.shapeProps,
		widgetProps: props.widgetProps,
	};
}

function createMockEditor( initialShapes: TLShape[] ) {
	const shapes = [ ...initialShapes ];
	const editor = {
		getCurrentPageShapes: () => shapes,
		getShape: ( shapeId: TLShapeId ) => shapes.find( ( shape ) => shape.id === shapeId ),
		createShapes: ( partials: TLShapePartial[] ) => {
			shapes.push( ...( partials as TLShape[] ) );
		},
		createShape: ( partial: TLShapePartial ) => {
			shapes.push( partial as TLShape );
		},
		createBindings: vi.fn(),
		sendToBack: vi.fn(),
		updateShape: ( partial: TLShapePartial ) => {
			const index = shapes.findIndex( ( shape ) => shape.id === partial.id );
			if ( index === -1 ) {
				return;
			}
			shapes[ index ] = mergeShape( shapes[ index ], partial );
		},
		updateShapes: ( partials: TLShapePartial[] ) => {
			for ( const partial of partials ) {
				const index = shapes.findIndex( ( shape ) => shape.id === partial.id );
				if ( index !== -1 ) {
					shapes[ index ] = mergeShape( shapes[ index ], partial );
				}
			}
		},
		deleteShapes: ( shapeIds: TLShapeId[] ) => {
			for ( const shapeId of shapeIds ) {
				const index = shapes.findIndex( ( shape ) => shape.id === shapeId );
				if ( index !== -1 ) {
					shapes.splice( index, 1 );
				}
			}
		},
	} as unknown as Editor;
	return editor;
}

function mergeShape( shape: TLShape, partial: TLShapePartial ): TLShape {
	return {
		...shape,
		...partial,
		props: {
			...( shape.props as Record< string, unknown > ),
			...( partial.props as Record< string, unknown > | undefined ),
		},
		meta: {
			...( shape.meta ?? {} ),
			...( partial.meta ?? {} ),
		},
	} as TLShape;
}
