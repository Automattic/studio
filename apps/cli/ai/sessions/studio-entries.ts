import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type {
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from '@studio/common/ai/sessions/entry-types';

export function appendStudioEntry< T extends StudioCustomEntryType >(
	sm: SessionManager,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): string {
	return sm.appendCustomEntry( customType, data );
}
