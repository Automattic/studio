import path from 'path';

function formatDatePart( value: number ): string {
	return String( value ).padStart( 2, '0' );
}

// Bucket sessions by local calendar date: <rootDirectory>/<YYYY>/<MM>/<DD>.
export function getAiSessionsDirectoryForDate( rootDirectory: string, date: Date ): string {
	const year = String( date.getFullYear() );
	const month = formatDatePart( date.getMonth() + 1 );
	const day = formatDatePart( date.getDate() );
	return path.join( rootDirectory, year, month, day );
}
