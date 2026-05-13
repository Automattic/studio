import type { DeskWidgetDefinition } from '@/ui-desks/widgets/types';

export function isWidgetAvailableInDeskContext(
	definition: DeskWidgetDefinition,
	hasSiteContext: boolean
) {
	return hasSiteContext || ! definition.requiresRunningSite;
}

export function isWidgetCreationDisabled(
	definition: DeskWidgetDefinition,
	canAddWidgets: boolean,
	isSiteRunning: boolean
) {
	return ! canAddWidgets || ( definition.requiresRunningSite && ! isSiteRunning );
}
