/**
 * Runs on the static host: Spacefast serves `functions/` as workers, and the dev and preview
 * servers call it directly. WordPress.com's backup download can't be read cross-origin, so the
 * page reads it through here, one range at a time. Spacefast strips `Range` before a worker sees
 * it, hence the custom header. The token travels in a header to stay out of access logs.
 */
export async function GET(
	request: Request,
	{ params: { site, download } }: { params: Record< string, string > }
): Promise< Response > {
	const token = request.headers.get( 'x-backup-token' );
	const range = request.headers.get( 'x-backup-range' );
	if (
		! /^\d+$/.test( site ) ||
		! /^\d+$/.test( download ) ||
		! token ||
		! /^bytes=\d+-\d+$/.test( range ?? '' )
	) {
		return new Response( 'Invalid backup request', { status: 400 } );
	}

	const query = new URLSearchParams( { token } );
	const upstream = await fetch(
		`https://public-api.wordpress.com/wpcom/v2/sites/${ site }/rewind/downloads/${ download }/data?${ query }`,
		{ headers: { Range: range as string } }
	);
	return new Response( upstream.body, {
		status: upstream.status,
		headers: {
			// Every range of every backup shares this URL's path, so nothing may cache it.
			'Cache-Control': 'no-store',
			'X-Backup-Content-Range': upstream.headers.get( 'content-range' ) ?? '',
		},
	} );
}
