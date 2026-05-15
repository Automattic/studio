import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import {
	collapseThemeMaterialsStackForShapeInEditor,
	setThemeMaterialsStackViewInEditor,
} from './stack';
import { getThemeMaterialsStackId, THEME_WIDGET_TYPE } from './types';
import type { Editor, TLShape } from 'tldraw';

const { collapseStackInEditorMock, setStackViewInEditorMock } = vi.hoisted( () => ( {
	collapseStackInEditorMock: vi.fn(),
	setStackViewInEditorMock: vi.fn(),
} ) );

vi.mock( '@/ui-desks/stacks/editor-commands', () => ( {
	collapseStackInEditor: collapseStackInEditorMock,
	setStackViewInEditor: setStackViewInEditorMock,
} ) );

describe( 'theme materials stack helpers', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'opens moved theme material stacks from their current position', () => {
		const stackId = getThemeMaterialsStackId( 'theme-1' );
		const editor = createEditor( [ createThemeShape() ] );

		setThemeMaterialsStackViewInEditor( editor, stackId, 'tiles' );

		expect( setStackViewInEditorMock ).toHaveBeenCalledWith( editor, stackId, 'tiles', undefined );
	} );

	it( 'collapses theme material stacks back to the theme card slot', () => {
		const stackId = getThemeMaterialsStackId( 'theme-1' );
		const editor = createEditor( [ createThemeShape() ] );

		setThemeMaterialsStackViewInEditor( editor, stackId, 'stack' );

		expect( setStackViewInEditorMock ).toHaveBeenCalledWith( editor, stackId, 'stack', {
			anchorCenter: { x: 570, y: 220 },
		} );
	} );

	it( 'collapses circular material stacks without clearing their configured circle mode', () => {
		const stackId = getThemeMaterialsStackId( 'theme-1' );
		const editor = createEditor( [
			createThemeShape(),
			createStackMemberShape( stackId, {
				deskStackExpanded: true,
				deskStackOpenViewMode: 'circle',
			} ),
		] );

		collapseThemeMaterialsStackForShapeInEditor( editor, createThemeShape() );

		expect( collapseStackInEditorMock ).toHaveBeenCalledWith( editor, stackId );
		expect( setStackViewInEditorMock ).not.toHaveBeenCalled();
	} );
} );

function createEditor( shapes: TLShape[] ) {
	return {
		getCurrentPageShapes: vi.fn( () => shapes ),
		updateShape: vi.fn(),
		updateShapes: vi.fn(),
	} as unknown as Editor;
}

function createThemeShape( overrides: Partial< TLShape > = {} ) {
	return {
		id: 'shape:theme-1',
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: 0,
		y: 0,
		props: {
			widgetType: THEME_WIDGET_TYPE,
			shapeProps: {
				w: 760,
				h: 440,
			},
			widgetProps: {},
		},
		...overrides,
	} as unknown as TLShape;
}

function createStackMemberShape( stackId: string, meta: Record< string, unknown > = {} ) {
	return {
		id: 'shape:theme-1:styles',
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: 0,
		y: 0,
		meta: {
			deskStackId: stackId,
			deskStackOrder: 0,
			...meta,
		},
		props: {
			widgetType: 'theme-styles',
			shapeProps: {
				w: 220,
				h: 160,
			},
			widgetProps: {},
		},
	} as unknown as TLShape;
}
