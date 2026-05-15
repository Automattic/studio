import type {
	DeskWidget,
	DeskWidgetDefinition,
	WidgetEditAction,
	WidgetEditActionContext,
} from '@/ui-desks/widgets/types';

export function getWidgetEditAction(
	definition: DeskWidgetDefinition,
	widget: DeskWidget,
	context: Omit< WidgetEditActionContext< DeskWidget >, 'widget' >
): WidgetEditAction | null {
	const getEditAction = definition.getEditAction as
		| ( ( actionContext: WidgetEditActionContext< DeskWidget > ) => WidgetEditAction | null )
		| undefined;

	return getEditAction?.( { widget, ...context } ) ?? null;
}
