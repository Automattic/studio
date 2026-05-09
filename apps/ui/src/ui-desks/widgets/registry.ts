import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import type { WidgetCreationDefinition } from './types';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
};

type RegisteredWidgetDefinition = ( typeof widgetDefinitions )[ keyof typeof widgetDefinitions ];
export type CreatableWidgetDefinition = RegisteredWidgetDefinition & {
	creation: WidgetCreationDefinition;
};

export function getWidgetDefinition( type: string ) {
	return widgetDefinitions[ type as keyof typeof widgetDefinitions ];
}

export function getCreatableWidgetDefinitions() {
	return Object.values( widgetDefinitions ).filter( hasCreation );
}

function hasCreation(
	definition: RegisteredWidgetDefinition
): definition is CreatableWidgetDefinition {
	return 'creation' in definition && Boolean( definition.creation );
}
