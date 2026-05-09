import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export function getSelectedWidgetToolbarItem( widgets: DeskWidget[] ) {
	if ( widgets.length !== 1 ) {
		return null;
	}

	const [ widget ] = widgets;
	const definition = getWidgetDefinition( widget.type );
	if (
		! definition ||
		! definition.controls?.length ||
		! definition.isWidgetProps( widget.widgetProps )
	) {
		return null;
	}

	return {
		definition,
		widget,
	};
}
