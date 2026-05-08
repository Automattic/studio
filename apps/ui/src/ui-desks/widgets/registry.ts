import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
};

export function getWidgetDefinition( type: string ) {
	return widgetDefinitions[ type as keyof typeof widgetDefinitions ];
}
