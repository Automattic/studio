import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';
import type { ComponentType } from 'react';
import type { TLShapeId } from 'tldraw';

export interface DeskWidgetComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: TLShapeId;
	shapeType: string;
	widgetProps: TWidgetProps;
}

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
	shapeType: TWidget[ 'shapeType' ];
	Component: ComponentType< DeskWidgetComponentProps< TWidget[ 'widgetProps' ] > >;
	isWidgetProps: ( props: unknown ) => props is TWidget[ 'widgetProps' ];
}

export type DeskWidget = NoteWidget;
