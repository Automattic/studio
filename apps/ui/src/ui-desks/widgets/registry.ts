import { mediaWidgetDefinition } from '@/ui-desks/widgets/media/definition';
import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { postCollectionWidgetDefinition } from '@/ui-desks/widgets/post-collection/definition';
import { sitePreviewWidgetDefinition } from '@/ui-desks/widgets/site-preview/definition';
import type { DeskWidgetDefinition } from './types';

export const widgetDefinitions = {
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
	[ mediaWidgetDefinition.type ]: mediaWidgetDefinition,
	[ postWidgetDefinition.type ]: postWidgetDefinition,
	[ pageWidgetDefinition.type ]: pageWidgetDefinition,
	[ postCollectionWidgetDefinition.type ]: postCollectionWidgetDefinition,
	[ sitePreviewWidgetDefinition.type ]: sitePreviewWidgetDefinition,
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
