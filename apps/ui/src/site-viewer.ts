// Shows one page of a site that a Studio tab is running. The site is served by
// Playground's service worker, which reaches that tab's runtime only from pages
// of this origin, so a site opens here rather than at its Playground URL.
const PLAYGROUND_REMOTE_URL =
	import.meta.env.VITE_PLAYGROUND_REMOTE_URL ?? 'https://playground.wordpress.net/remote.html';

const params = new URLSearchParams( window.location.search );
const scope = params.get( 'scope' ) ?? '';
const path = ( params.get( 'path' ) ?? '/' ).replace( /^\/?/, '/' );
const frame = document.getElementById( 'site' ) as HTMLIFrameElement;

// The origin Playground serves sites from, which only Playground's own hosts may be.
function siteOrigin(): string | null {
	const remote = new URL( PLAYGROUND_REMOTE_URL );
	try {
		const origin = new URL( params.get( 'origin' ) ?? remote.origin );
		const trusted =
			origin.hostname === remote.hostname || origin.hostname.endsWith( '.wordpress.net' );
		return origin.protocol === 'https:' && trusted ? origin.origin : null;
	} catch {
		return null;
	}
}

const origin = siteOrigin();
if ( origin && /^[a-z0-9-]+$/.test( scope ) ) {
	frame.src = `${ origin }/scope:${ scope }${ path }`;
}
