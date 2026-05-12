import { useRef } from 'react';
import { useEditor, useValue, type TLShape } from 'tldraw';
import { useDesk } from '@/ui-desks/desk/provider/context';
import { expandStackInEditor } from './editor-commands';
import { getStackId, getStackOrder, getStackViewMode, isStackExpanded } from './utils';
import type { PointerEvent } from 'react';

export function useStackShapeInteraction( shape: TLShape ) {
	const editor = useEditor();
	const { isReadOnly, pressedStackId, pressStack } = useDesk();
	const pointerDownPointRef = useRef< { x: number; y: number } | null >( null );
	const stackId = getStackId( shape );
	const isExpanded = isStackExpanded( shape );
	const isTiles = getStackViewMode( shape ) === 'tiles';
	const hoveredStackId = useValue(
		'desk-stack-hovered-stack-id',
		() => {
			const hoveredShape = editor.getHoveredShape();
			const hoveredShapeStackId = getStackId( hoveredShape );
			return hoveredShapeStackId &&
				! isStackExpanded( hoveredShape ) &&
				getStackViewMode( hoveredShape ) !== 'tiles'
				? hoveredShapeStackId
				: null;
		},
		[ editor ]
	);
	const isHovered = Boolean( stackId ) && ! isExpanded && ! isTiles && hoveredStackId === stackId;
	const isPressed = Boolean( stackId ) && ! isExpanded && ! isTiles && pressedStackId === stackId;
	const order = getStackOrder( shape );
	const members = stackId
		? editor.getCurrentPageShapes().filter( ( member ) => getStackId( member ) === stackId )
		: [];
	const center = ( members.length - 1 ) / 2;
	const step = order - center;
	const hoverTranslate = isHovered ? step * 7 : 0;
	const hoverRotate = isHovered ? step * 2.5 : 0;
	const pressScale = isPressed ? 0.985 : 1;

	return {
		style: {
			width: '100%',
			height: '100%',
			transform: `translate(${ hoverTranslate }px, ${ hoverTranslate }px) rotate(${ hoverRotate }deg) scale(${ pressScale })`,
			transformOrigin: 'center',
			transition: 'transform 220ms ease',
		},
		onPointerDown: ( event: PointerEvent ) => {
			if ( stackId && ! isExpanded && ! isTiles ) {
				pressStack( stackId );
				if ( isReadOnly ) {
					pointerDownPointRef.current = {
						x: event.clientX,
						y: event.clientY,
					};
					event.preventDefault();
					event.stopPropagation();
				}
			}
		},
		onPointerUp: ( event: PointerEvent ) => {
			if ( ! isReadOnly || ! stackId || isExpanded || isTiles ) {
				pointerDownPointRef.current = null;
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if ( didPointerMove( pointerDownPointRef.current, event ) ) {
				pointerDownPointRef.current = null;
				return;
			}

			pointerDownPointRef.current = null;
			if ( expandStackInEditor( editor, stackId ) ) {
				editor.setSelectedShapes( [] );
			}
		},
	};
}

function didPointerMove( origin: { x: number; y: number } | null, event: PointerEvent ) {
	if ( ! origin ) {
		return true;
	}

	const deltaX = event.clientX - origin.x;
	const deltaY = event.clientY - origin.y;
	return Math.hypot( deltaX, deltaY ) > 6;
}
