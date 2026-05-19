import { useEffect, useRef } from 'react';
import {
	collapseThemeMaterialsStackForShapeInEditor,
	collapseThemeMaterialsStacksInEditor,
	setThemeMaterialsStackViewInEditor,
} from '@/ui-desks/widgets/theme/stack';
import { isThemeMaterialsStackId } from '@/ui-desks/widgets/theme/types';
import { collapseAllExpandedStacksInEditor, expandStackInEditor } from './editor-commands';
import { getStackConfiguredViewMode, getStackId, getStackViewMode, isStackExpanded } from './utils';
import type { Editor, TLEventInfo, TLShapeId } from 'tldraw';

export function useStackInteractions( editor: Editor | null ) {
	useStackDragSelection( editor );
	useTiledStackDragSelection( editor );
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

function useTiledStackDragSelection( editor: Editor | null ) {
	const restoreSelectionRef = useRef< TLShapeId[] | null >( null );
	const activeMemberIdsRef = useRef< TLShapeId[] >( [] );
	const movedShapeIdsRef = useRef( new Set< string >() );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const movedShapeIds = movedShapeIdsRef.current;
		const unsubscribeShapeChanges = editor.sideEffects.registerAfterChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! restoreSelectionRef.current || activeMemberIdsRef.current.length === 0 ) {
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

		const handleTiledStackDragSelection = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' ) {
				return;
			}

			if ( info.name === 'pointer_down' ) {
				if ( info.button !== 0 || restoreSelectionRef.current ) {
					return;
				}

				const hitShape = getShapeAtPointer( editor );
				const stackId = getStackId( hitShape );
				if ( ! hitShape || ! stackId || getStackViewMode( hitShape ) === 'stack' ) {
					return;
				}

				const memberIds = editor
					.getCurrentPageShapes()
					.filter( ( shape ) => getStackId( shape ) === stackId )
					.map( ( shape ) => shape.id );
				if ( memberIds.length <= 1 ) {
					return;
				}

				const selectedShapeIds = editor.getSelectedShapeIds();
				const selectedStackMemberIds = selectedShapeIds.filter( ( shapeId ) =>
					memberIds.includes( shapeId )
				);
				if ( selectedStackMemberIds.length === memberIds.length ) {
					return;
				}

				restoreSelectionRef.current = selectedShapeIds.includes( hitShape.id )
					? selectedShapeIds
					: [ hitShape.id ];
				activeMemberIdsRef.current = memberIds;
				movedShapeIds.clear();
				editor.setSelectedShapes( memberIds );
				return;
			}

			if ( info.name === 'pointer_up' ) {
				const restoreSelection = restoreSelectionRef.current;
				if ( ! restoreSelection ) {
					return;
				}

				restoreSelectionRef.current = null;
				const existingMemberIds = activeMemberIdsRef.current.filter( ( shapeId ) =>
					editor.getShape( shapeId )
				);
				const movedStack = existingMemberIds.some( ( shapeId ) => movedShapeIds.has( shapeId ) );
				activeMemberIdsRef.current = [];
				movedShapeIds.clear();

				if ( movedStack ) {
					if ( existingMemberIds.length > 0 ) {
						editor.setSelectedShapes( existingMemberIds );
					}
					return;
				}

				const existingRestoreSelection = restoreSelection.filter( ( shapeId ) =>
					editor.getShape( shapeId )
				);
				if ( existingRestoreSelection.length > 0 ) {
					editor.setSelectedShapes( existingRestoreSelection );
				}
			}
		};

		editor.on( 'event', handleTiledStackDragSelection );
		return () => {
			restoreSelectionRef.current = null;
			activeMemberIdsRef.current = [];
			movedShapeIds.clear();
			editor.off( 'event', handleTiledStackDragSelection );
			unsubscribeShapeChanges();
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
				if ( isThemeMaterialsStackId( clickedStackId ) ) {
					const stackShape = editor
						.getCurrentPageShapes()
						.find( ( shape ) => getStackId( shape ) === clickedStackId );
					const didOpen =
						getStackConfiguredViewMode( stackShape ) === 'circle'
							? expandStackInEditor( editor, clickedStackId )
							: setThemeMaterialsStackViewInEditor( editor, clickedStackId, 'tiles' );
					if ( didOpen ) {
						editor.setSelectedShapes( [] );
					}
					return;
				}
				if ( expandStackInEditor( editor, clickedStackId ) ) {
					editor.setSelectedShapes( [] );
				}
				return;
			}

			const selectedShapeIds = editor.getSelectedShapeIds();
			const movedSelection = selectedShapeIds.some( ( shapeId ) => movedShapeIds.has( shapeId ) );
			if ( movedSelection ) {
				movedShapeIds.clear();
				return;
			}

			if ( selectedShapeIds.length === 1 ) {
				const [ selectedShapeId ] = selectedShapeIds;
				if (
					collapseThemeMaterialsStackForShapeInEditor( editor, editor.getShape( selectedShapeId ) )
				) {
					movedShapeIds.clear();
					return;
				}
			}

			if ( selectedShapeIds.length === 0 ) {
				collapseAllExpandedStacksInEditor( editor );
				collapseThemeMaterialsStacksInEditor( editor );
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
	const stackId = getStackIdAtPointer( editor );
	const hitShape = getShapeAtPointer( editor );
	return stackId && ! isStackExpanded( hitShape ) && getStackViewMode( hitShape ) === 'stack'
		? stackId
		: null;
}

function getStackIdAtPointer( editor: Editor ) {
	return getStackId( getShapeAtPointer( editor ) );
}

function getShapeAtPointer( editor: Editor ) {
	const hitShape = editor.getShapeAtPoint( editor.inputs.currentPagePoint, {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} );
	return hitShape;
}
