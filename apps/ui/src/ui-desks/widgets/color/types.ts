import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const COLOR_WIDGET_TYPE = 'color';

export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export type ColorWidgetProps = {
	color: string;
	title?: string;
	format?: ColorFormat;
};

export type ColorWidget = DeskWidgetBase<
	typeof COLOR_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ColorWidgetProps
>;

export function isColorWidgetProps( value: unknown ): value is ColorWidgetProps {
	const candidate = value as Partial< ColorWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		isHexColor( candidate.color ) &&
		( candidate.title === undefined || typeof candidate.title === 'string' ) &&
		( candidate.format === undefined ||
			candidate.format === 'hex' ||
			candidate.format === 'rgb' ||
			candidate.format === 'hsl' )
	);
}

export function isHexColor( value: unknown ): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test( value );
}
