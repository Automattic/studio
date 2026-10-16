import { readAuthToken } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';

// What a WordPress.com site allows, read from the platform: the features its
// plan turns on and what the logged-in user's role may do there. The active
// site line states it, and wpcom_request refuses writes it does not allow.
export interface WpcomSiteCapabilities {
	planName: string;
	features: ReadonlySet< string >;
	canManage: boolean;
	canEdit: boolean;
}

// Plan features that decide what an agent can do on a site, in the words the
// active site line uses.
const DESCRIBED_FEATURES: Array< [ feature: string, label: string ] > = [
	[ 'global-styles', 'Global Styles' ],
	[ 'custom-design', 'custom CSS' ],
	[ 'install-plugins', 'installing plugins' ],
	[ 'upload-themes', 'uploading themes' ],
	[ 'premium-themes', 'premium themes' ],
	[ 'ssh', 'SSH and SFTP' ],
	[ 'staging-sites', 'staging sites' ],
	[ 'studio-sync', 'Studio push and pull' ],
];

const LABELS = new Map( [ ...DESCRIBED_FEATURES, [ 'manage-plugins', 'managing plugins' ] ] );

const cache = new Map< number, Promise< WpcomSiteCapabilities | undefined > >();

// Fetched once per site per process. Undefined when the platform cannot be
// asked (logged out, offline): writes then go through and the API decides.
export function getWpcomSiteCapabilities(
	siteId: number
): Promise< WpcomSiteCapabilities | undefined > {
	let pending = cache.get( siteId );
	if ( ! pending ) {
		pending = fetchCapabilities( siteId ).catch( () => undefined );
		cache.set( siteId, pending );
	}
	return pending;
}

export function clearWpcomSiteCapabilitiesCache(): void {
	cache.clear();
}

async function fetchCapabilities( siteId: number ): Promise< WpcomSiteCapabilities | undefined > {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) return undefined;
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const site = await wpcom.req.get< {
		plan?: { product_name_short?: string; features?: { active?: string[] } };
		capabilities?: Record< string, boolean >;
	} >( `/sites/${ siteId }`, { fields: 'ID,plan,capabilities' } );
	return parseWpcomSiteCapabilities( site );
}

export function parseWpcomSiteCapabilities( site: {
	plan?: { product_name_short?: string; features?: { active?: string[] } };
	capabilities?: Record< string, boolean >;
} ): WpcomSiteCapabilities | undefined {
	if ( ! site.plan ) return undefined;
	return {
		planName: site.plan.product_name_short ?? 'unknown',
		features: new Set( site.plan.features?.active ?? [] ),
		canManage: site.capabilities?.manage_options === true,
		canEdit: site.capabilities?.edit_posts === true,
	};
}

// "Personal plan: Global Styles, installing plugins; not custom CSS, …; you manage this site".
export function describeWpcomSiteCapabilities( capabilities: WpcomSiteCapabilities ): string {
	const has = DESCRIBED_FEATURES.filter( ( [ feature ] ) => capabilities.features.has( feature ) );
	const lacks = DESCRIBED_FEATURES.filter(
		( [ feature ] ) => ! capabilities.features.has( feature )
	);
	const role = capabilities.canManage
		? 'you manage this site'
		: capabilities.canEdit
		? 'you edit content only'
		: 'you can only read this site';
	return [
		`${ capabilities.planName } plan`,
		has.length ? `includes ${ has.map( ( [ , label ] ) => label ).join( ', ' ) }` : '',
		lacks.length ? `not ${ lacks.map( ( [ , label ] ) => label ).join( ', ' ) }` : '',
		role,
	]
		.filter( Boolean )
		.join( '; ' );
}

export interface WpcomWrite {
	method: string;
	path: string;
	// '' is WordPress.com REST API v1.1.
	apiNamespace: string;
	body?: Record< string, unknown >;
}

// What a write needs: plan features and whether it is a site-admin change.
function requirementsOf( write: WpcomWrite ): { features: string[]; admin: boolean } {
	const path = write.path.replace( /^\/+/, '/' ).split( '?' )[ 0 ];
	if ( /^\/global-styles(\/|$)/.test( path ) ) {
		const styles = write.body?.styles as Record< string, unknown > | undefined;
		const css = typeof styles?.css === 'string' && styles.css.trim() !== '';
		return {
			features: css ? [ 'global-styles', 'custom-design' ] : [ 'global-styles' ],
			admin: true,
		};
	}
	if ( /^\/plugins(\/|$)/.test( path ) ) {
		const installs =
			/\/install$/.test( path ) ||
			path === '/plugins/new' ||
			( write.apiNamespace === 'wp/v2' && path === '/plugins' );
		return { features: [ installs ? 'install-plugins' : 'manage-plugins' ], admin: true };
	}
	if ( /^\/themes\/(upload|new)$/.test( path ) ) {
		return { features: [ 'upload-themes' ], admin: true };
	}
	if ( /^\/themes(\/|$)/.test( path ) || /^\/settings(\/|$)/.test( path ) ) {
		return { features: [], admin: true };
	}
	return { features: [], admin: false };
}

export function getWpcomWriteRefusal(
	capabilities: WpcomSiteCapabilities,
	write: WpcomWrite
): string | undefined {
	if ( write.method === 'GET' ) return undefined;
	const { features, admin } = requirementsOf( write );
	if ( admin && ! capabilities.canManage ) {
		return `Not sent: ${ write.method } ${ write.path } changes site settings, and the user's role on this site does not manage it. A site administrator can make this change.`;
	}
	if ( ! admin && ! capabilities.canEdit && ! capabilities.canManage ) {
		return `Not sent: the user's role on this site cannot change its content.`;
	}
	const missing = features.filter( ( feature ) => ! capabilities.features.has( feature ) );
	if ( missing.length > 0 ) {
		const names = missing.map( ( feature ) => LABELS.get( feature ) ?? feature ).join( ' and ' );
		return `Not sent: this site's ${ capabilities.planName } plan does not include ${ names }. The hosting-plans-helper skill finds the plan that does.`;
	}
	return undefined;
}
