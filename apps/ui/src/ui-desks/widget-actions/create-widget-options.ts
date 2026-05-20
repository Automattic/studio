import { getThemeGlobalStyles } from '@/ui-desks/widgets/theme/api';
import { getThemeStylesWidgetProps } from '@/ui-desks/widgets/theme-styles/defaults';
import { THEME_STYLES_WIDGET_TYPE } from '@/ui-desks/widgets/theme-styles/types';
import type { AddDeskWidgetOptions } from '@/ui-desks/desk/provider/context';
import type { DeskWidgetDefinition, WidgetResolverRegistry } from '@/ui-desks/widgets/types';

export async function getCreateWidgetOptions(
	definition: DeskWidgetDefinition,
	registry: WidgetResolverRegistry,
	options: AddDeskWidgetOptions = {}
): Promise< AddDeskWidgetOptions > {
	let widgetProps = options.widgetProps;

	if ( definition.type === THEME_STYLES_WIDGET_TYPE ) {
		try {
			widgetProps = {
				...getThemeStylesWidgetProps( await getThemeGlobalStyles( { registry } ) ),
				...( widgetProps ?? {} ),
			};
		} catch ( error ) {
			console.warn( 'Failed to load theme styles for a new style card.', error );
			widgetProps = {
				...getThemeStylesWidgetProps( null ),
				...( widgetProps ?? {} ),
			};
		}
	}

	return {
		...options,
		...( widgetProps ? { widgetProps } : {} ),
		shouldStartEditing: options.shouldStartEditing ?? definition.shouldStartEditingOnCreate,
	};
}
