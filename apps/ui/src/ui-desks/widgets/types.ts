import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';
import type { ComponentProps, ComponentType, ReactElement } from 'react';
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

export type WidgetIcon = ReactElement< ComponentProps< 'svg' > >;

export interface WidgetCreationDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	getLabel: () => string;
	icon?: WidgetIcon;
	getInitialWidget: () => Pick< TWidget, 'shapeProps' | 'widgetProps' >;
	getInitialSize: ( shapeProps: TWidget[ 'shapeProps' ] ) => { w: number; h: number };
	startEditing?: boolean;
}

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
	shapeType: string;
	Component: ComponentType< DeskWidgetComponentProps< TWidget[ 'widgetProps' ] > >;
	isWidgetProps: ( props: unknown ) => props is TWidget[ 'widgetProps' ];
	getIndicator?: ( widgetProps: TWidget[ 'widgetProps' ] ) => WidgetIndicator;
	creation?: WidgetCreationDefinition< TWidget >;
}

export type DeskWidget = NoteWidget;
