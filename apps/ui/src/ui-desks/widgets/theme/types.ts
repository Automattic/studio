import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskStackViewMode, DeskWidgetBase } from '@studio/common/types/desk';

export const THEME_WIDGET_TYPE = 'theme';
export const THEME_MATERIALS_STACK_KEY = 'materials';

export const THEME_CARD_SHAPE_PROPS = {
	w: 760,
	h: 440,
} as const;

export const THEME_MATERIAL_SHAPE_PROPS = {
	w: 220,
	h: 160,
} as const;

export type ThemeWidgetProps = {
	viewMode?: DeskStackViewMode;
};

export type ThemeWidget = DeskWidgetBase<
	typeof THEME_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ThemeWidgetProps
>;

export function getThemeMaterialsStackId( widgetId: string ) {
	return `theme:${ widgetId }:${ THEME_MATERIALS_STACK_KEY }`;
}

export function getThemeWidgetIdFromMaterialsStackId( stackId: string | null | undefined ) {
	const prefix = 'theme:';
	const suffix = `:${ THEME_MATERIALS_STACK_KEY }`;
	if ( ! stackId?.startsWith( prefix ) || ! stackId.endsWith( suffix ) ) {
		return null;
	}

	const widgetId = stackId.slice( prefix.length, -suffix.length );
	return widgetId || null;
}

export function isThemeMaterialsStackId( stackId: string | null | undefined ) {
	return getThemeWidgetIdFromMaterialsStackId( stackId ) !== null;
}

export function getThemeMaterialsStackPosition( widget: {
	x: number;
	y: number;
	shapeProps: RectangleWidgetShapeProps;
} ) {
	const anchorCenter = {
		x: widget.x + ( widget.shapeProps.w * 3 ) / 4,
		y: widget.y + widget.shapeProps.h / 2,
	};
	return {
		x: anchorCenter.x - THEME_MATERIAL_SHAPE_PROPS.w / 2,
		y: anchorCenter.y - THEME_MATERIAL_SHAPE_PROPS.h / 2,
	};
}

export function isThemeWidgetProps( value: unknown ): value is ThemeWidgetProps {
	const candidate = value as Partial< ThemeWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( candidate.viewMode === undefined ||
			candidate.viewMode === 'stack' ||
			candidate.viewMode === 'tiles' ||
			candidate.viewMode === 'circle' )
	);
}
