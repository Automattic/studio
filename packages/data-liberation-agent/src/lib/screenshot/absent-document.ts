export function isAbsentDocumentStatus( status: number ): boolean {
	return status === 404 || status === 410;
}

export function isAbsentDocumentError( error: string ): boolean {
	return /^HTTP (404|410)\b/.test( error );
}

export function failuresAreAbsentDocument(
	failures: Array< { url?: unknown; error?: unknown } >,
	url: string
): boolean {
	const forUrl = failures.filter( ( failure ) => failure.url === url );
	return (
		forUrl.length > 0 &&
		forUrl.every(
			( failure ) =>
				typeof failure.error === 'string' && isAbsentDocumentError( failure.error )
		)
	);
}

export function isSourceCaptureUrl( url: string, sourceUrl: string | undefined ): boolean {
	if ( ! sourceUrl ) return false;
	try {
		return normalizeRoute( url ) === normalizeRoute( sourceUrl );
	} catch {
		return url === sourceUrl;
	}
}

function normalizeRoute( url: string ): string {
	const route = new URL( url );
	route.hash = '';
	route.search = '';
	route.pathname = route.pathname.replace( /\/$/, '' ) || '/';
	return route.href;
}
