import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';

export const defaultUserDesk: DeskConfig = {
	version: DESK_CONFIG_VERSION,
	updatedAt: new Date().toISOString(),
	widgets: [
		{
			id: 'welcome-note',
			type: 'note',
			x: 160,
			y: 120,
			zIndex: 'a1',
			shapeProps: {
				w: 200,
				h: 200,
			},
			widgetProps: {
				text: '',
				tone: 'yellow',
			},
		},
	],
};
