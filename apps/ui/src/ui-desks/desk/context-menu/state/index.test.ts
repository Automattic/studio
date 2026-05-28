import { describe, expect, it, vi } from 'vitest';
import { resolveDeskContextMenuState } from './index';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

describe( 'resolveDeskContextMenuState', () => {
	it( 'clears selection for empty canvas menus', () => {
		const editor = createEditorMock( {
			shapes: [ createShape( 'shape:a' ) ],
			hitShapeId: null,
			selectedShapeIds: [ 'shape:a' as TLShapeId ],
		} );

		const state = resolveDeskContextMenuState( editor, 12, 24 );

		expect( state ).toMatchObject( {
			kind: 'empty',
			shapeIds: [],
			pagePoint: { x: 12, y: 24 },
		} );
		expect( editor.setSelectedShapes ).toHaveBeenCalledWith( [] );
	} );

	it( 'selects all stack members when right-clicking a stack member', () => {
		const editor = createEditorMock( {
			shapes: [
				createShape( 'shape:a', 'stack-1' ),
				createShape( 'shape:b', 'stack-1' ),
				createShape( 'shape:c' ),
			],
			hitShapeId: 'shape:a',
		} );

		const state = resolveDeskContextMenuState( editor, 4, 8 );

		expect( state.kind ).toBe( 'multi' );
		expect( state.shapeIds ).toEqual( [ 'shape:a', 'shape:b' ] );
		expect( editor.setSelectedShapes ).toHaveBeenCalledWith( [ 'shape:a', 'shape:b' ] );
	} );

	it( 'keeps an existing multi-selection when right-clicking inside it', () => {
		const editor = createEditorMock( {
			shapes: [ createShape( 'shape:a' ), createShape( 'shape:b' ), createShape( 'shape:c' ) ],
			hitShapeId: 'shape:b',
			selectedShapeIds: [ 'shape:a' as TLShapeId, 'shape:b' as TLShapeId ],
		} );

		const state = resolveDeskContextMenuState( editor, 4, 8 );

		expect( state.kind ).toBe( 'multi' );
		expect( state.shapeIds ).toEqual( [ 'shape:a', 'shape:b' ] );
		expect( editor.setSelectedShapes ).not.toHaveBeenCalled();
	} );

	it( 'selects the hit shape for single-shape menus', () => {
		const editor = createEditorMock( {
			shapes: [ createShape( 'shape:a' ), createShape( 'shape:b' ) ],
			hitShapeId: 'shape:b',
			selectedShapeIds: [ 'shape:a' as TLShapeId ],
		} );

		const state = resolveDeskContextMenuState( editor, 4, 8 );

		expect( state.kind ).toBe( 'single' );
		expect( state.shapeIds ).toEqual( [ 'shape:b' ] );
		expect( editor.setSelectedShapes ).toHaveBeenCalledWith( [ 'shape:b' ] );
	} );

	it( 'keeps page coordinates viewport-based while positioning menus inside an embedded boundary', () => {
		const editor = createEditorMock( {
			shapes: [],
			hitShapeId: null,
		} );

		const state = resolveDeskContextMenuState( editor, 312, 144, {
			boundaryRect: {
				left: 240,
				top: 40,
				width: 800,
				height: 600,
			},
		} );

		expect( state ).toMatchObject( {
			kind: 'empty',
			pagePoint: { x: 312, y: 144 },
			x: 72,
			y: 104,
			boundary: {
				width: 800,
				height: 600,
			},
		} );
		expect( editor.screenToPage ).toHaveBeenCalledWith( { x: 312, y: 144 } );
	} );
} );

function createShape( id: string, stackId?: string ) {
	return {
		id: id as TLShapeId,
		type: 'geo',
		meta: stackId ? { deskStackId: stackId } : {},
	} as TLShape;
}

function createEditorMock( {
	shapes,
	hitShapeId,
	selectedShapeIds = [],
}: {
	shapes: TLShape[];
	hitShapeId: string | null;
	selectedShapeIds?: TLShapeId[];
} ) {
	let selection = selectedShapeIds;
	const getShape = vi.fn( ( id: TLShapeId ) => shapes.find( ( shape ) => shape.id === id ) );
	return {
		getCurrentPageShapes: vi.fn( () => shapes ),
		getSelectedShapeIds: vi.fn( () => selection ),
		getShape,
		getShapeAtPoint: vi.fn( () =>
			hitShapeId ? getShape( hitShapeId as TLShapeId ) : undefined
		),
		screenToPage: vi.fn( ( point ) => point ),
		setSelectedShapes: vi.fn( ( shapeIds: TLShapeId[] ) => {
			selection = shapeIds;
		} ),
	} as unknown as Pick<
		Editor,
		| 'getCurrentPageShapes'
		| 'getSelectedShapeIds'
		| 'getShape'
		| 'getShapeAtPoint'
		| 'screenToPage'
		| 'setSelectedShapes'
	>;
}
