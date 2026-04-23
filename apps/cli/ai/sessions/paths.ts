import path from 'path';
import { getAiSessionsDirectoryForDate as getDirectoryForDate } from '@studio/common/ai/sessions/paths';
import { getAppdataDirectory } from 'cli/lib/appdata';

export function getAiSessionsRootDirectory(): string {
	return path.join( getAppdataDirectory(), 'sessions' );
}

export function getAiSessionsDirectoryForDate( date: Date ): string {
	return getDirectoryForDate( getAiSessionsRootDirectory(), date );
}
