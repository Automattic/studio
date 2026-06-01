import { describe, expect, it, vi } from 'vitest';
import {
	deskWidgetToCanvasShape,
	resolvedDeskWidgetToCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import { selectDerivedWidgetsForSelectedSource } from './resolvers';
import type { DeskWidget, ResolvedDeskWidget } from '@/ui-desks/widgets/types';
import type { Editor, TLShape } from 'tldraw';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
} ) );

describe( 'desk widget resolvers', () => {
	it( 'moves selection from a resolved source widget to its derived widgets', () => {
		const { editor, derivedShapes, setSelectedShapes } = createPostCollectionResolverEditor( {
			selectSource: true,
		} );

		selectDerivedWidgetsForSelectedSource( editor, 'collection-1' );

		expect( setSelectedShapes ).toHaveBeenCalledWith( derivedShapes.map( ( shape ) => shape.id ) );
	} );

	it( 'keeps the current selection when it is no longer only the source widget', () => {
		const { editor, setSelectedShapes } = createPostCollectionResolverEditor( {
			selectSource: false,
		} );

		selectDerivedWidgetsForSelectedSource( editor, 'collection-1' );

		expect( setSelectedShapes ).not.toHaveBeenCalled();
	} );

	it( 'keeps the source selected until derived widgets exist', () => {
		const { editor, setSelectedShapes } = createPostCollectionResolverEditor( {
			selectSource: true,
			includeDerivedShapes: false,
		} );

		selectDerivedWidgetsForSelectedSource( editor, 'collection-1' );

		expect( setSelectedShapes ).not.toHaveBeenCalled();
	} );
} );

function createPostCollectionResolverEditor( {
	selectSource,
	includeDerivedShapes = true,
}: {
	selectSource: boolean;
	includeDerivedShapes?: boolean;
} ) {
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
	const shapes = includeDerivedShapes ? [ sourceShape, ...derivedShapes ] : [ sourceShape ];
	const selectedShapeIds = selectSource
		? [ sourceShape.id ]
		: derivedShapes.map( ( shape ) => shape.id );
	const setSelectedShapes = vi.fn();
	const editor = {
		getCurrentPageShapes: () => shapes,
		getSelectedShapeIds: () => selectedShapeIds,
		setSelectedShapes,
	} as unknown as Editor;

	return { editor, derivedShapes, setSelectedShapes };
}
