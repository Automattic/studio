export function getSiteBrowserUrl(
	site: { url: string; landingPage?: string },
	relativeUrl = '',
	autoLogin = true,
	user?: string
): string {
	const usingLandingPage = ! relativeUrl && !! site.landingPage;
	let target = new URL( relativeUrl || site.landingPage || '/', site.url );
	if ( autoLogin || usingLandingPage ) {
		const login = new URL( '/studio-auto-login', site.url );
		login.searchParams.set( 'redirect_to', target.toString() );
		if ( user ) {
			login.searchParams.set( 'user', user );
		}
		target = login;
	}
	return target.toString();
}
