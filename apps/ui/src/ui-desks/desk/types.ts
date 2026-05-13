import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { DeskConfig as BaseDeskConfig } from '@studio/common/types/desk';

export { DESK_CONFIG_VERSION } from '@studio/common/types/desk';
export type {
	DeskStack,
	DeskStackViewMode,
	DeskViewport,
	DeskWidgetBase,
} from '@studio/common/types/desk';

export interface DeskConnectorEndpoint {
	widgetId: string;
	normalizedAnchor: {
		x: number;
		y: number;
	};
}

export interface DeskConnector {
	id: string;
	from: DeskConnectorEndpoint;
	to: DeskConnectorEndpoint;
	bend?: number;
}

export type DeskConfig = BaseDeskConfig< DeskWidget > & {
	connectors?: DeskConnector[];
};
