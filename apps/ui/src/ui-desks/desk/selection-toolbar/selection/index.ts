import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import type { StackViewMode } from '@/ui-desks/stacks/utils';
import type { DeskWidget } from '@/ui-desks/widgets/types';

interface SelectedWidgetToolbarOptions {
	stackIds?: string[];
	stackViewMode?: StackViewMode;
	canStack?: boolean;
	canUnstack?: boolean;
	canSetStackView?: boolean;
	canRemove?: boolean;
}

interface SelectedWidgetToolbarBase {
	widgets: DeskWidget[];
	stackIds: string[];
	stackViewMode?: StackViewMode;
	canStack: boolean;
	canUnstack: boolean;
	canSetStackView: boolean;
	canRemove: boolean;
}

export type SelectedWidgetToolbarItem =
	| ( SelectedWidgetToolbarBase & {
			kind: 'single-widget';
			definition: NonNullable< ReturnType< typeof getWidgetDefinition > >;
			widget: DeskWidget;
	  } )
	| ( SelectedWidgetToolbarBase & {
			kind: 'multi-widget';
	  } );

export function getSelectedWidgetToolbarItem(
	widgets: DeskWidget[],
	options: SelectedWidgetToolbarOptions = {}
): SelectedWidgetToolbarItem | null {
	if ( widgets.length === 0 ) {
		return null;
	}

	const stackIds = options.stackIds ?? [];
	const base = {
		widgets,
		stackIds,
		stackViewMode: options.stackViewMode,
		canStack: ( options.canStack ?? true ) && widgets.length >= 2 && stackIds.length === 0,
		canUnstack: ( options.canUnstack ?? true ) && stackIds.length > 0,
		canSetStackView:
			( options.canSetStackView ?? true ) &&
			stackIds.length === 1 &&
			Boolean( options.stackViewMode ),
		canRemove: options.canRemove ?? true,
	};

	if ( widgets.length !== 1 ) {
		return {
			...base,
			kind: 'multi-widget',
		};
	}

	const [ widget ] = widgets;
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return null;
	}

	if (
		! definition.controls?.length &&
		! definition.getFittedShapeProps &&
		! definition.getEditAction &&
		widget.type !== DRAWING_WIDGET_TYPE
	) {
		return null;
	}

	return {
		...base,
		kind: 'single-widget',
		definition,
		widget,
	};
}
