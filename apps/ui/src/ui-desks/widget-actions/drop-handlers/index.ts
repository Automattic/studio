import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import type { DeskWidget, WidgetDropHandler } from '@/ui-desks/widgets/types';

export function getWidgetDropHandler(
	sourceWidget: DeskWidget,
	targetWidget: DeskWidget
): WidgetDropHandler | null {
	const targetDefinition = getWidgetDefinition( targetWidget.type );
	const handlers = targetDefinition?.dropHandlers ?? [];

	return (
		handlers.find(
			( handler ) =>
				! handler.sourceTypes?.length || handler.sourceTypes.includes( sourceWidget.type )
		) ?? null
	);
}
