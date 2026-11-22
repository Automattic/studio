import type { BrowserContext } from 'playwright';

// The avatar Studio shows for the account: `useGravatarUrl` in apps/ui.
const GRAVATAR = 'https://www.gravatar.com/avatar/**';

/**
 * Answers Studio's Gravatar requests with a demo person's avatar, or with a
 * 404 when they have none, which Studio shows as its own placeholder.
 */
export async function answerGravatar( context: BrowserContext, avatar: Buffer | null ) {
	await context.route( GRAVATAR, ( route ) =>
		avatar
			? route.fulfill( { body: avatar, contentType: imageType( avatar ) } )
			: route.fulfill( { status: 404 } )
	);
}

function imageType( image: Buffer ) {
	if ( image.subarray( 0, 4 ).toString( 'hex' ) === '89504e47' ) {
		return 'image/png';
	}
	if ( image.subarray( 8, 12 ).toString() === 'WEBP' ) {
		return 'image/webp';
	}
	return 'image/jpeg';
}
