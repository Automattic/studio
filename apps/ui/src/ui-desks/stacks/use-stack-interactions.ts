import { useEffect, useRef } from 'react';
import { collapseAllExpandedStacksInEditor, expandStackInEditor } from './editor-commands';
import { getStackId, isStackExpanded } from './utils';
import type { Editor, TLEventInfo } from 'tldraw';

export function useStackInteractions( editor: Editor | null ) {
	useStackDragSelection( editor );
	useStackClickToOpen( editor );
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

function useStackClickToOpen( editor: Editor | null ) {
	const isPointerSessionRef = useRef( false );
	const pointerDownStackIdRef = useRef< string | null >( null );
	const movedShapeIdsRef = useRef( new Set< string >() );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const movedShapeIds = movedShapeIdsRef.current;
		const unsubscribeShapeChanges = editor.sideEffects.registerAfterChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! isPointerSessionRef.current ) {
					return;
				}

				if (
					previousShape.x !== nextShape.x ||
					previousShape.y !== nextShape.y ||
					previousShape.rotation !== nextShape.rotation
				) {
					movedShapeIds.add( nextShape.id );
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

				isPointerSessionRef.current = true;
				pointerDownStackIdRef.current = getCollapsedStackIdAtPointer( editor );
				movedShapeIds.clear();
				return;
			}

			if ( info.name !== 'pointer_up' || ! isPointerSessionRef.current ) {
				return;
			}

			isPointerSessionRef.current = false;
			const clickedStackId = pointerDownStackIdRef.current;
			pointerDownStackIdRef.current = null;
			if ( clickedStackId ) {
				const movedStack = editor
					.getCurrentPageShapes()
					.filter( ( shape ) => getStackId( shape ) === clickedStackId )
					.some( ( shape ) => movedShapeIds.has( shape.id ) );
				movedShapeIds.clear();
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
			movedShapeIds.clear();
		};

		editor.on( 'event', handleStackClick );
		return () => {
			isPointerSessionRef.current = false;
			pointerDownStackIdRef.current = null;
			movedShapeIds.clear();
			editor.off( 'event', handleStackClick );
			unsubscribeShapeChanges();
		};
	}, [ editor ] );
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
