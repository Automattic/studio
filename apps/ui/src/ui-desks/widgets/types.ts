import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';
import type { ComponentType } from 'react';
import type { TLShapeId } from 'tldraw';

export interface WidgetIndicator {
	cornerRadius?: number;
	stroke?: string;
}

export interface DeskWidgetComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: TLShapeId;
	shapeType: string;
	widgetProps: TWidgetProps;
}

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
	shapeType: string;
	Component: ComponentType< DeskWidgetComponentProps< TWidget[ 'widgetProps' ] > >;
	isWidgetProps: ( props: unknown ) => props is TWidget[ 'widgetProps' ];
	getIndicator?: ( widgetProps: TWidget[ 'widgetProps' ] ) => WidgetIndicator;
}

export type DeskWidget = NoteWidget;
