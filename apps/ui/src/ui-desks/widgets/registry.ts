import { blogWidgetDefinition } from '@/ui-desks/widgets/blog/definition';
import { bookmarkWidgetDefinition } from '@/ui-desks/widgets/bookmark/definition';
import { colorWidgetDefinition } from '@/ui-desks/widgets/color/definition';
import { drawingWidgetDefinition } from '@/ui-desks/widgets/drawing/definition';
import { embedWidgetDefinition } from '@/ui-desks/widgets/embed/definition';
import { loadingWidgetDefinition } from '@/ui-desks/widgets/loading/definition';
import { mediaWidgetDefinition } from '@/ui-desks/widgets/media/definition';
import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { pdfWidgetDefinition } from '@/ui-desks/widgets/pdf/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { postCollectionWidgetDefinition } from '@/ui-desks/widgets/post-collection/definition';
import { scratchpadWidgetDefinition } from '@/ui-desks/widgets/scratchpad/definition';
import { siteCardWidgetDefinition } from '@/ui-desks/widgets/site-card/definition';
import { sitePreviewWidgetDefinition } from '@/ui-desks/widgets/site-preview/definition';
import { themeWidgetDefinition } from '@/ui-desks/widgets/theme/definition';
import { themePatternWidgetDefinition } from '@/ui-desks/widgets/theme-pattern/definition';
import { themeStylesWidgetDefinition } from '@/ui-desks/widgets/theme-styles/definition';
import { themeTemplateWidgetDefinition } from '@/ui-desks/widgets/theme-template/definition';
import type { DeskWidgetDefinition } from './types';

export const widgetDefinitions = {
	[ scratchpadWidgetDefinition.type ]: scratchpadWidgetDefinition,
	[ embedWidgetDefinition.type ]: embedWidgetDefinition,
	[ pdfWidgetDefinition.type ]: pdfWidgetDefinition,
	[ bookmarkWidgetDefinition.type ]: bookmarkWidgetDefinition,
	[ colorWidgetDefinition.type ]: colorWidgetDefinition,
	[ blogWidgetDefinition.type ]: blogWidgetDefinition,
	[ drawingWidgetDefinition.type ]: drawingWidgetDefinition,
	[ loadingWidgetDefinition.type ]: loadingWidgetDefinition,
	[ noteWidgetDefinition.type ]: noteWidgetDefinition,
	[ mediaWidgetDefinition.type ]: mediaWidgetDefinition,
	[ postWidgetDefinition.type ]: postWidgetDefinition,
	[ pageWidgetDefinition.type ]: pageWidgetDefinition,
	[ postCollectionWidgetDefinition.type ]: postCollectionWidgetDefinition,
	[ siteCardWidgetDefinition.type ]: siteCardWidgetDefinition,
	[ sitePreviewWidgetDefinition.type ]: sitePreviewWidgetDefinition,
	[ themeWidgetDefinition.type ]: themeWidgetDefinition,
	[ themeTemplateWidgetDefinition.type ]: themeTemplateWidgetDefinition,
	[ themeStylesWidgetDefinition.type ]: themeStylesWidgetDefinition,
	[ themePatternWidgetDefinition.type ]: themePatternWidgetDefinition,
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
