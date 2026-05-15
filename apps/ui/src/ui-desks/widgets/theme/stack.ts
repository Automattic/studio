import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { setStackViewInEditor } from '@/ui-desks/stacks/editor-commands';
import { getStackId, getStackViewMode, getWidgetIdFromShapeId } from '@/ui-desks/stacks/utils';
import {
	getThemeMaterialsStackId,
	getThemeMaterialsStackPosition,
	getThemeWidgetIdFromMaterialsStackId,
	THEME_MATERIAL_SHAPE_PROPS,
	THEME_WIDGET_TYPE,
} from './types';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskStackViewMode } from '@studio/common/types/desk';
import type { Editor, JsonObject, TLShape } from 'tldraw';

export function setThemeMaterialsStackViewInEditor(
	editor: Editor,
	stackId: string,
	viewMode: DeskStackViewMode
) {
	const themeShape = getThemeShapeForMaterialsStack( editor, stackId );
	if ( ! themeShape ) {
		return false;
	}

	updateThemeWidgetViewMode( editor, themeShape, viewMode );
	return setStackViewInEditor( editor, stackId, viewMode, {
		anchorCenter: getThemeMaterialsStackAnchorCenter( themeShape ),
	} );
}

export function collapseThemeMaterialsStackForShapeInEditor(
	editor: Editor,
	shape: TLShape | null | undefined
) {
	if ( ! isThemeShape( shape ) ) {
		return false;
	}

	const stackId = getThemeMaterialsStackId( getWidgetIdFromShapeId( shape.id ) );
	const stackShape = editor
		.getCurrentPageShapes()
		.find( ( candidate ) => getStackId( candidate ) === stackId );
	if ( getStackViewMode( stackShape ) !== 'tiles' ) {
		return false;
	}

	return setThemeMaterialsStackViewInEditor( editor, stackId, 'stack' );
}

export function collapseThemeMaterialsStacksInEditor( editor: Editor ) {
	let didCollapse = false;
	for ( const shape of editor.getCurrentPageShapes() ) {
		didCollapse = collapseThemeMaterialsStackForShapeInEditor( editor, shape ) || didCollapse;
	}
	return didCollapse;
}

function getThemeShapeForMaterialsStack(
	editor: Editor,
	stackId: string
): RectangleWidgetShape | null {
	const widgetId = getThemeWidgetIdFromMaterialsStackId( stackId );
	if ( ! widgetId ) {
		return null;
	}

	for ( const shape of editor.getCurrentPageShapes() ) {
		if ( isThemeShape( shape ) && getWidgetIdFromShapeId( shape.id ) === widgetId ) {
			return shape;
		}
	}

	return null;
}

function isThemeShape( shape: TLShape | null | undefined ): shape is RectangleWidgetShape {
	return (
		shape?.type === RECTANGLE_WIDGET_SHAPE_TYPE &&
		( shape.props as { widgetType?: unknown } ).widgetType === THEME_WIDGET_TYPE
	);
}

function updateThemeWidgetViewMode(
	editor: Editor,
	shape: RectangleWidgetShape,
	viewMode: DeskStackViewMode
) {
	const widgetProps = ( shape.props.widgetProps ?? {} ) as JsonObject;
	if ( widgetProps.viewMode === viewMode ) {
		return;
	}

	editor.updateShape< RectangleWidgetShape >( {
		id: shape.id,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		props: {
			widgetProps: {
				...widgetProps,
				viewMode,
			},
		},
	} );
}

function getThemeMaterialsStackAnchorCenter( shape: RectangleWidgetShape ) {
	const position = getThemeMaterialsStackPosition( {
		x: shape.x,
		y: shape.y,
		shapeProps: shape.props.shapeProps as RectangleWidgetShapeProps,
	} );
	return {
		x: position.x + THEME_MATERIAL_SHAPE_PROPS.w / 2,
		y: position.y + THEME_MATERIAL_SHAPE_PROPS.h / 2,
	};
}
