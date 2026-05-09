import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
};

export function getWidgetDefinition( type: string ) {
	if ( ! Object.prototype.hasOwnProperty.call( widgetDefinitions, type ) ) {
		return undefined;
	}

	return widgetDefinitions[ type as keyof typeof widgetDefinitions ];
}

export function getCreatableWidgetDefinitions() {
	return Object.values( widgetDefinitions );
}
