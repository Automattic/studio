import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { getStackId, getWidgetIdFromShapeId } from '@/ui-desks/stacks/utils';
import { getThemeMaterialsStackId, THEME_WIDGET_TYPE } from './types';
import type { Editor, TLShape } from 'tldraw';

export function moveThemeMaterialsStackWithThemeShapeInEditor(
	editor: Editor,
	previousShape: TLShape,
	nextShape: TLShape
) {
	if (
		! isThemeShape( nextShape ) ||
		( previousShape.x === nextShape.x && previousShape.y === nextShape.y )
	) {
		return;
	}

	const stackId = getThemeMaterialsStackId( getWidgetIdFromShapeId( nextShape.id ) );
	const dx = nextShape.x - previousShape.x;
	const dy = nextShape.y - previousShape.y;
	const members = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getStackId( shape ) === stackId );
	if ( members.length === 0 ) {
		return;
	}

	editor.updateShapes(
		members.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			x: shape.x + dx,
			y: shape.y + dy,
		} ) )
	);
}

function isThemeShape( shape: TLShape | null | undefined ): shape is RectangleWidgetShape {
	return (
		shape?.type === RECTANGLE_WIDGET_SHAPE_TYPE &&
		( shape.props as { widgetType?: unknown } ).widgetType === THEME_WIDGET_TYPE
	);
}
