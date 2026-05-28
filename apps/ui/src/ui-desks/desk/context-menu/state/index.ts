import { getStackId } from '@/ui-desks/stacks/utils';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

export type DeskContextMenuKind = 'empty' | 'single' | 'multi';

export interface DeskContextMenuState {
	kind: DeskContextMenuKind;
	x: number;
	y: number;
	boundary?: {
		width: number;
		height: number;
	};
	pagePoint: {
		x: number;
		y: number;
	};
	shapeIds: TLShapeId[];
}

export type ContextMenuResolverEditor = Pick<
	Editor,
	| 'getCurrentPageShapes'
	| 'getSelectedShapeIds'
	| 'getShapeAtPoint'
	| 'screenToPage'
	| 'setSelectedShapes'
>;

export function resolveDeskContextMenuState(
	editor: ContextMenuResolverEditor,
	x: number,
	y: number,
	options: {
		boundaryRect?: Pick< DOMRect, 'left' | 'top' | 'width' | 'height' >;
	} = {}
): DeskContextMenuState {
	const pagePoint = editor.screenToPage( { x, y } );
	const boundary = options.boundaryRect
		? {
				width: options.boundaryRect.width,
				height: options.boundaryRect.height,
		  }
		: undefined;
	const menuPoint = options.boundaryRect
		? {
				x: x - options.boundaryRect.left,
				y: y - options.boundaryRect.top,
		  }
		: { x, y };
	const shape = editor.getShapeAtPoint( pagePoint, {
		hitInside: true,
		renderingOnly: true,
	} ) as TLShape | undefined;

	if ( ! shape ) {
		editor.setSelectedShapes( [] );
		return { kind: 'empty', shapeIds: [], pagePoint, x: menuPoint.x, y: menuPoint.y, boundary };
	}

	const stackId = getStackId( shape );
	if ( stackId ) {
		const memberIds = editor
			.getCurrentPageShapes()
			.filter( ( member ) => getStackId( member ) === stackId )
			.map( ( member ) => member.id );
		editor.setSelectedShapes( memberIds );
		return {
			kind: 'multi',
			shapeIds: memberIds,
			pagePoint,
			x: menuPoint.x,
			y: menuPoint.y,
			boundary,
		};
	}

	const currentSelection = editor.getSelectedShapeIds();
	if ( currentSelection.includes( shape.id ) && currentSelection.length > 1 ) {
		return {
			kind: 'multi',
			shapeIds: currentSelection,
			pagePoint,
			x: menuPoint.x,
			y: menuPoint.y,
			boundary,
		};
	}

	editor.setSelectedShapes( [ shape.id ] );
	return {
		kind: 'single',
		shapeIds: [ shape.id ],
		pagePoint,
		x: menuPoint.x,
		y: menuPoint.y,
		boundary,
	};
}
