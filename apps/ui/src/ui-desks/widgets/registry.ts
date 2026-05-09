import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import type { DeskWidgetDefinition } from './types';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
	[ postWidgetDefinition.type ]: postWidgetDefinition,
} satisfies Record< string, DeskWidgetDefinition >;

export function getWidgetDefinition( type: string ) {
	if ( ! Object.prototype.hasOwnProperty.call( widgetDefinitions, type ) ) {
		return undefined;
	}

	return widgetDefinitions[ type as keyof typeof widgetDefinitions ] as DeskWidgetDefinition;
}

export function getCreatableWidgetDefinitions() {
	return ( Object.values( widgetDefinitions ) as DeskWidgetDefinition[] ).filter(
		( definition ) => definition.isCreatable !== false
	);
}
