import { getWidgetDefinition } from './registry';
import type { TLShapeId, TLShapePartial, TLUnknownShape } from 'tldraw';

interface CreateWidgetShapeOptions {
	id: TLShapeId;
	type: string;
	center: {
		x: number;
		y: number;
	};
}

export interface CreatedWidgetShape {
	shape: TLShapePartial< TLUnknownShape >;
	startEditing: boolean;
}

export function createWidgetShape( {
	id,
	type,
	center,
}: CreateWidgetShapeOptions ): CreatedWidgetShape | null {
	const definition = getWidgetDefinition( type );
	if ( ! definition?.creation ) {
		return null;
	}

	const initialWidget = definition.creation.getInitialWidget();
	const size = definition.creation.getInitialSize( initialWidget.shapeProps );

	return {
		shape: {
			id,
			type: definition.shapeType,
			x: center.x - size.w / 2,
			y: center.y - size.h / 2,
			props: {
				widgetType: definition.type,
				shapeProps: initialWidget.shapeProps,
				widgetProps: initialWidget.widgetProps,
			},
		},
		startEditing: Boolean( definition.creation.startEditing ),
	};
}
