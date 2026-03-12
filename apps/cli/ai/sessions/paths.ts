import path from 'path';
import { getAppdataDirectory } from 'cli/lib/appdata';

function formatDatePart( value: number ): string {
	return String( value ).padStart( 2, '0' );
}

export function getAiSessionsRootDirectory(): string {
	return path.join( getAppdataDirectory(), 'sessions' );
}

export function getAiSessionsDirectoryForDate( date: Date ): string {
	const year = String( date.getFullYear() );
	const month = formatDatePart( date.getMonth() + 1 );
	const day = formatDatePart( date.getDate() );
	return path.join( getAiSessionsRootDirectory(), year, month, day );
}
