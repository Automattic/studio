import {
	TldrawSelectionForeground,
	type TLSelectionForegroundProps,
	useEditor,
	useValue,
} from 'tldraw';
import { StackBadges } from './badges';
import { getStackId, isStackExpanded } from './utils';

export function StackCanvasOverlays() {
	return <StackBadges />;
}

export function StackAwareSelectionForeground( props: TLSelectionForegroundProps ) {
	const editor = useEditor();
	const hideForStack = useValue(
		'desk-stack-selection-foreground',
		() => {
			const selectedShapeIds = editor.getSelectedShapeIds();
			if ( selectedShapeIds.length === 0 ) {
				return false;
			}

			let selectedStackId: string | null = null;
			let hasExpandedStackMember = false;
			for ( const shapeId of selectedShapeIds ) {
				const shape = editor.getShape( shapeId );
				const stackId = getStackId( shape );
				if ( ! stackId ) {
					return false;
				}

				if ( selectedStackId === null ) {
					selectedStackId = stackId;
				} else if ( selectedStackId !== stackId ) {
					return false;
				}

				hasExpandedStackMember = hasExpandedStackMember || isStackExpanded( shape );
			}

			return selectedStackId !== null && ! hasExpandedStackMember;
		},
		[ editor ]
	);

	if ( hideForStack ) {
		return null;
	}

	return <TldrawSelectionForeground { ...props } />;
}
