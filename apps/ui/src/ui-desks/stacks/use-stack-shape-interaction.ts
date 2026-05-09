import { useEditor, useValue, type TLShape } from 'tldraw';
import { useStackAnimation } from './context';
import { getStackId, getStackOrder, isStackExpanded } from './utils';

export function useStackShapeInteraction( shape: TLShape ) {
	const editor = useEditor();
	const { pressedStackId, pressStack } = useStackAnimation();
	const stackId = getStackId( shape );
	const isExpanded = isStackExpanded( shape );
	const hoveredStackId = useValue(
		'desk-stack-hovered-stack-id',
		() => {
			const hoveredShape = editor.getHoveredShape();
			const hoveredShapeStackId = getStackId( hoveredShape );
			return hoveredShapeStackId && ! isStackExpanded( hoveredShape ) ? hoveredShapeStackId : null;
		},
		[ editor ]
	);
	const isHovered = Boolean( stackId ) && ! isExpanded && hoveredStackId === stackId;
	const isPressed = Boolean( stackId ) && ! isExpanded && pressedStackId === stackId;
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
		onPointerDown: () => {
			if ( stackId && ! isExpanded ) {
				pressStack( stackId );
			}
		},
	};
}
