import type { ControlConfig } from '@/ui-desks/controls/types';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';
import type { ComponentProps, ComponentType, ReactElement } from 'react';

export interface WidgetIndicator {
	cornerRadius?: number;
	stroke?: string;
}

export interface DeskWidgetComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	widgetProps: TWidgetProps;
	isEditing: boolean;
	onWidgetPropsChange: ( widgetProps: TWidgetProps ) => void;
	onEditComplete: () => void;
}

export type WidgetIcon = ReactElement< ComponentProps< 'svg' > >;

export interface WidgetLabels {
	add: () => string;
}

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
	Component: ComponentType< DeskWidgetComponentProps< TWidget[ 'widgetProps' ] > >;
	controls?: Array< ControlConfig< TWidget[ 'widgetProps' ] > >;
	isWidgetProps: ( props: unknown ) => props is TWidget[ 'widgetProps' ];
	labels: WidgetLabels;
	icon?: WidgetIcon;
	getInitialWidget: () => Pick< TWidget, 'shapeProps' | 'widgetProps' >;
	getIndicator?: ( widgetProps: TWidget[ 'widgetProps' ] ) => WidgetIndicator;
}

export type DeskWidget = NoteWidget;
