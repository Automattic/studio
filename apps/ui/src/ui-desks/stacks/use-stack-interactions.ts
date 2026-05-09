import { useEffect } from 'react';
import { collapseAllExpandedStacksInEditor, expandStackInEditor } from './editor-commands';
import { getStackId, isStackExpanded } from './utils';
import type { MutableRefObject } from 'react';
import type { Editor, TLEventInfo } from 'tldraw';

export interface StackInteractionState {
	isPointerSessionRef: MutableRefObject< boolean >;
	pointerDownStackIdRef: MutableRefObject< string | null >;
	movedShapeIdsRef: MutableRefObject< Set< string > >;
}

export function useStackInteractions( editor: Editor | null, state: StackInteractionState ) {
	useStackDragSelection( editor );
	useStackClickToOpen( editor, state );
}

function useStackDragSelection( editor: Editor | null ) {
	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const selectStackMembersForDrag = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' || info.name !== 'pointer_down' || info.button !== 0 ) {
				return;
			}

			const stackId = getCollapsedStackIdAtPointer( editor );
			if ( ! stackId ) {
				return;
			}

			const memberIds = editor
				.getCurrentPageShapes()
				.filter( ( shape ) => getStackId( shape ) === stackId )
				.map( ( shape ) => shape.id );
			if ( memberIds.length > 1 ) {
				editor.setSelectedShapes( memberIds );
			}
		};

		editor.on( 'event', selectStackMembersForDrag );
		return () => {
			editor.off( 'event', selectStackMembersForDrag );
		};
	}, [ editor ] );
}

function useStackClickToOpen( editor: Editor | null, state: StackInteractionState ) {
	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const unsubscribeShapeChanges = editor.sideEffects.registerAfterChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! state.isPointerSessionRef.current ) {
					return;
				}

				if (
					previousShape.x !== nextShape.x ||
					previousShape.y !== nextShape.y ||
					previousShape.rotation !== nextShape.rotation
				) {
					state.movedShapeIdsRef.current.add( nextShape.id );
				}
			}
		);

		const handleStackClick = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' ) {
				return;
			}

			if ( info.name === 'pointer_down' ) {
				if ( info.button !== 0 ) {
					return;
				}

				state.isPointerSessionRef.current = true;
				state.pointerDownStackIdRef.current = getCollapsedStackIdAtPointer( editor );
				state.movedShapeIdsRef.current.clear();
				return;
			}

			if ( info.name !== 'pointer_up' || ! state.isPointerSessionRef.current ) {
				return;
			}

			state.isPointerSessionRef.current = false;
			const clickedStackId = state.pointerDownStackIdRef.current;
			state.pointerDownStackIdRef.current = null;
			if ( clickedStackId ) {
				const movedStack = editor
					.getCurrentPageShapes()
					.filter( ( shape ) => getStackId( shape ) === clickedStackId )
					.some( ( shape ) => state.movedShapeIdsRef.current.has( shape.id ) );
				state.movedShapeIdsRef.current.clear();
				if ( movedStack ) {
					return;
				}
				if ( expandStackInEditor( editor, clickedStackId ) ) {
					editor.setSelectedShapes( [] );
				}
				return;
			}

			const selectedShapeIds = editor.getSelectedShapeIds();
			if ( selectedShapeIds.length === 0 ) {
				collapseAllExpandedStacksInEditor( editor );
			}
			state.movedShapeIdsRef.current.clear();
		};

		editor.on( 'event', handleStackClick );
		return () => {
			state.isPointerSessionRef.current = false;
			state.pointerDownStackIdRef.current = null;
			state.movedShapeIdsRef.current.clear();
			editor.off( 'event', handleStackClick );
			unsubscribeShapeChanges();
		};
	}, [ editor, state ] );
}

function getCollapsedStackIdAtPointer( editor: Editor ) {
	const hitShape = editor.getShapeAtPoint( editor.inputs.currentPagePoint, {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} );
	const stackId = getStackId( hitShape );
	return stackId && ! isStackExpanded( hitShape ) ? stackId : null;
}
