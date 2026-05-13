import { blogWidgetDefinition } from '@/ui-desks/widgets/blog/definition';
import { bookmarkWidgetDefinition } from '@/ui-desks/widgets/bookmark/definition';
import { drawingWidgetDefinition } from '@/ui-desks/widgets/drawing/definition';
import { embedWidgetDefinition } from '@/ui-desks/widgets/embed/definition';
import { loadingWidgetDefinition } from '@/ui-desks/widgets/loading/definition';
import { mediaWidgetDefinition } from '@/ui-desks/widgets/media/definition';
import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { postCollectionWidgetDefinition } from '@/ui-desks/widgets/post-collection/definition';
import { scratchpadWidgetDefinition } from '@/ui-desks/widgets/scratchpad/definition';
import { sitePreviewWidgetDefinition } from '@/ui-desks/widgets/site-preview/definition';
import type { DeskWidgetDefinition } from './types';

export const widgetDefinitions = {
	[ scratchpadWidgetDefinition.type ]: scratchpadWidgetDefinition,
	[ embedWidgetDefinition.type ]: embedWidgetDefinition,
	[ bookmarkWidgetDefinition.type ]: bookmarkWidgetDefinition,
	[ blogWidgetDefinition.type ]: blogWidgetDefinition,
	[ drawingWidgetDefinition.type ]: drawingWidgetDefinition,
	[ loadingWidgetDefinition.type ]: loadingWidgetDefinition,
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
