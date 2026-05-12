import { getWidgetDefinition } from './registry';
import type { DeskWidget } from './types';

interface CreateDeskWidgetOptions {
	id: string;
	type: string;
	center: {
		x: number;
		y: number;
	};
	zIndex: string;
	shapeProps?: Record< string, unknown >;
	widgetProps?: Record< string, unknown >;
}

export function createDeskWidget( {
	id,
	type,
	center,
	zIndex,
	shapeProps,
	widgetProps,
}: CreateDeskWidgetOptions ): DeskWidget | null {
	const definition = getWidgetDefinition( type );
	if ( ! definition ) {
		return null;
	}

	const initialWidget = definition.getInitialWidget();
	const nextShapeProps = {
		...initialWidget.shapeProps,
		...shapeProps,
	};
	const nextWidgetProps = {
		...initialWidget.widgetProps,
		...widgetProps,
	};
	if ( ! definition.isWidgetProps( nextWidgetProps ) ) {
		return null;
	}
	const size = getWidgetSize( nextShapeProps );

	return {
		id,
		type: definition.type,
		x: center.x - size.w / 2,
		y: center.y - size.h / 2,
		zIndex,
		shapeProps: nextShapeProps,
		widgetProps: nextWidgetProps,
	} as DeskWidget;
}

function getWidgetSize( shapeProps: Record< string, unknown > ) {
	const { w, h } = shapeProps;

	return {
		w: typeof w === 'number' ? w : 0,
		h: typeof h === 'number' ? h : 0,
	};
}
