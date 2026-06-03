import type { DeskConnector, DeskStack } from '@/ui-desks/desk/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export interface DeskFocusDesk {
	widgets: DeskWidget[];
	stacks?: DeskStack[];
	connectors?: DeskConnector[];
}

export interface DeskFocusMode {
	widgetId: string;
	focusDesk: DeskFocusDesk;
}

export function createEmptyFocusDesk(): DeskFocusDesk {
	return { widgets: [] };
}
