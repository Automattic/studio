import { PROTOCOL_PREFIX } from '@studio/common/constants';

export type StudioAction =
	| { action: 'new-site' }
	| { action: 'open-site'; siteId: string }
	// Pulls a WordPress.com or Pressable site into the local site connected to it, or a new one.
	| { action: 'pull-site'; remoteSiteId: number };

export function buildStudioActionLink( target: StudioAction ): string {
	const url = new URL( `${ PROTOCOL_PREFIX }://app/v1/${ target.action }` );
	if ( target.action === 'open-site' ) {
		url.searchParams.set( 'id', target.siteId );
	} else if ( target.action === 'pull-site' ) {
		url.searchParams.set( 'remoteSiteId', String( target.remoteSiteId ) );
	}
	return url.href;
}

export function parseStudioActionLink( value: string ): StudioAction | null {
	try {
		const url = new URL( value );
		if (
			url.protocol !== `${ PROTOCOL_PREFIX }:` ||
			url.host !== 'app' ||
			url.username ||
			url.password ||
			url.hash
		) {
			return null;
		}
		if ( url.pathname === '/v1/new-site' && ! url.search ) {
			return { action: 'new-site' };
		}
		const remoteSiteIds = url.searchParams.getAll( 'remoteSiteId' );
		if (
			url.pathname === '/v1/pull-site' &&
			[ ...url.searchParams.keys() ].length === 1 &&
			remoteSiteIds.length === 1 &&
			/^[1-9][0-9]*$/.test( remoteSiteIds[ 0 ] )
		) {
			return { action: 'pull-site', remoteSiteId: Number( remoteSiteIds[ 0 ] ) };
		}
		const ids = url.searchParams.getAll( 'id' );
		if ( url.pathname === '/v1/open-site' && ids.length === 1 && ids[ 0 ].trim() ) {
			return { action: 'open-site', siteId: ids[ 0 ] };
		}
	} catch {
		return null;
	}
	return null;
}
