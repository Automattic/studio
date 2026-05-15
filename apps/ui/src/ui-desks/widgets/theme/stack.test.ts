import { describe, expect, it, vi } from 'vitest';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import { moveThemeMaterialsStackWithThemeShapeInEditor } from './drag';
import { setThemeMaterialsStackViewInEditor } from './stack';
import { getThemeMaterialsStackId, THEME_WIDGET_TYPE } from './types';
import type { Editor, TLShape } from 'tldraw';

const { setStackViewInEditorMock } = vi.hoisted( () => ( {
	setStackViewInEditorMock: vi.fn(),
} ) );

vi.mock( '@/ui-desks/stacks/editor-commands', () => ( {
	setStackViewInEditor: setStackViewInEditorMock,
} ) );

describe( 'theme materials stack helpers', () => {
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

	it( 'moves theme material stack members with the theme card', () => {
		const stackId = getThemeMaterialsStackId( 'theme-1' );
		const member = createStackMember( stackId );
		const editor = createEditor( [ createThemeShape(), member ] );

		moveThemeMaterialsStackWithThemeShapeInEditor(
			editor,
			createThemeShape( { x: 0, y: 0 } ),
			createThemeShape( { x: 24, y: 16 } )
		);

		expect( editor.updateShapes ).toHaveBeenCalledWith( [
			{
				id: member.id,
				type: member.type,
				x: 124,
				y: 116,
			},
		] );
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

function createStackMember( stackId: string ) {
	return {
		id: 'shape:theme-material-1',
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: 100,
		y: 100,
		meta: {
			deskStackId: stackId,
		},
		props: {
			widgetType: 'theme-template',
			shapeProps: {
				w: 220,
				h: 160,
			},
			widgetProps: {},
		},
	} as unknown as TLShape;
}
