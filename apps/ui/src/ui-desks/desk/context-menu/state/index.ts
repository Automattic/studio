import { getStackId } from '@/ui-desks/stacks/utils';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

export type DeskContextMenuKind = 'empty' | 'single' | 'multi';

export interface DeskContextMenuState {
	kind: DeskContextMenuKind;
	x: number;
	y: number;
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
	y: number
): DeskContextMenuState {
	const pagePoint = editor.screenToPage( { x, y } );
	const shape = editor.getShapeAtPoint( pagePoint, {
		hitInside: true,
		renderingOnly: true,
	} ) as TLShape | undefined;

	if ( ! shape ) {
		editor.setSelectedShapes( [] );
		return { kind: 'empty', shapeIds: [], pagePoint, x, y };
	}

	const stackId = getStackId( shape );
	if ( stackId ) {
		const memberIds = editor
			.getCurrentPageShapes()
			.filter( ( member ) => getStackId( member ) === stackId )
			.map( ( member ) => member.id );
		editor.setSelectedShapes( memberIds );
		return { kind: 'multi', shapeIds: memberIds, pagePoint, x, y };
	}

	const currentSelection = editor.getSelectedShapeIds();
	if ( currentSelection.includes( shape.id ) && currentSelection.length > 1 ) {
		return { kind: 'multi', shapeIds: currentSelection, pagePoint, x, y };
	}

	editor.setSelectedShapes( [ shape.id ] );
	return { kind: 'single', shapeIds: [ shape.id ], pagePoint, x, y };
}
