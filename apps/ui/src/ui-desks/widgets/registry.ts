import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
};

type RegisteredWidgetDefinition = ( typeof widgetDefinitions )[ keyof typeof widgetDefinitions ];
export type CreatableWidgetDefinition = RegisteredWidgetDefinition;

export function getWidgetDefinition( type: string ) {
	return widgetDefinitions[ type as keyof typeof widgetDefinitions ];
}

export function getCreatableWidgetDefinitions() {
	return Object.values( widgetDefinitions );
}
