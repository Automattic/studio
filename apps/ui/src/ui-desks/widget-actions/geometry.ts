export type RectangleWidgetShapeProps = {
	w: number;
	h: number;
};

export function isRectangleWidgetShapeProps( value: unknown ): value is RectangleWidgetShapeProps {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof ( value as Partial< RectangleWidgetShapeProps > ).w === 'number' &&
		typeof ( value as Partial< RectangleWidgetShapeProps > ).h === 'number'
	);
}
