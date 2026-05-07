import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { createNoteWidget } from '@/ui-desks/widgets/note/defaults';

export function createDefaultUserDesk(): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		widgets: [
			createNoteWidget( {
				id: 'welcome-note',
				x: 160,
				y: 120,
				zIndex: 'a1',
				text: '',
			} ),
		],
	};
}
