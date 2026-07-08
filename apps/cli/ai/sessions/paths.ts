import {
	getAiSessionsDirectoryForDate as getDirectoryForDate,
	getAiSessionsRootDirectory,
} from '@studio/common/ai/sessions/paths';

export { getAiSessionsRootDirectory };

export function getAiSessionsDirectoryForDate( date: Date ): string {
	return getDirectoryForDate( getAiSessionsRootDirectory(), date );
}
