import { readAuthToken } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';

// What a WordPress.com site allows, read from the platform: the features its
// plan turns on and what the logged-in user's role may do there. The active
// site line states it, and wpcom_request refuses writes it does not allow.
export interface WpcomSiteCapabilities {
	planName: string;
	features: ReadonlySet< string >;
	// Each feature the plan lacks, with the product slugs of the plans that have it.
	plansWith: Readonly< Record< string, readonly string[] > >;
	canManage: boolean;
	canEdit: boolean;
}

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
		plan?: {
			product_name_short?: string;
			features?: { active?: string[]; available?: Record< string, string[] > };
		};
		capabilities?: Record< string, boolean >;
	} >( `/sites/${ siteId }`, { fields: 'ID,plan,capabilities' } );
	return parseWpcomSiteCapabilities( site );
}

// The plans this site can move to, by product slug, under the names its plan
// cards use: the platform's own offer, without the plans it no longer sells.
export async function getWpcomUpgradePlans( siteId: number ): Promise< Map< string, string > > {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) return new Map();
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const plans = await wpcom.req.get< Record< string, WpcomPlan > >( {
		path: `/sites/${ siteId }/plans`,
		apiNamespace: 'rest/v1.3',
	} );
	return parseWpcomUpgradePlans( plans );
}

interface WpcomPlan {
	product_slug?: string;
	plan_card_name?: string;
	plan_card_order?: number;
	available_for_upgrade?: boolean;
}

export function parseWpcomUpgradePlans(
	plans: Record< string, WpcomPlan >
): Map< string, string > {
	return new Map(
		Object.values( plans )
			.filter( ( plan ) => plan.available_for_upgrade && plan.product_slug && plan.plan_card_name )
			.sort( ( a, b ) => ( a.plan_card_order ?? 0 ) - ( b.plan_card_order ?? 0 ) )
			.map( ( plan ) => [ plan.product_slug!, plan.plan_card_name! ] )
	);
}

export function parseWpcomSiteCapabilities( site: {
	plan?: {
		product_name_short?: string;
		features?: { active?: string[]; available?: Record< string, string[] > };
	};
	capabilities?: Record< string, boolean >;
} ): WpcomSiteCapabilities | undefined {
	if ( ! site.plan ) return undefined;
	return {
		planName: site.plan.product_name_short ?? 'unknown',
		features: new Set( site.plan.features?.active ?? [] ),
		plansWith: site.plan.features?.available ?? {},
		canManage: site.capabilities?.manage_options === true,
		canEdit: site.capabilities?.edit_posts === true,
	};
}

// "Personal plan; you manage this site". What the plan includes is stated when
// a write needs it: wpcom_request refuses it, naming the plans that do.
export function describeWpcomSiteCapabilities( capabilities: WpcomSiteCapabilities ): string {
	const role = capabilities.canManage
		? 'you manage this site'
		: capabilities.canEdit
		? 'you edit content only'
		: 'you can only read this site';
	return `${ capabilities.planName } plan; ${ role }`;
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

// Asks for the plans that would allow a write only when the site's plan does not.
export async function getWpcomWriteRefusal(
	capabilities: WpcomSiteCapabilities,
	write: WpcomWrite,
	upgradePlans: () => Promise< ReadonlyMap< string, string > > = async () => new Map()
): Promise< string | undefined > {
	if ( write.method === 'GET' ) return undefined;
	const { features, admin } = requirementsOf( write );
	if ( admin && ! capabilities.canManage ) {
		return `Not sent: ${ write.method } ${ write.path } changes site settings, and the user's role on this site does not manage it. A site administrator can make this change.`;
	}
	if ( ! admin && ! capabilities.canEdit && ! capabilities.canManage ) {
		return `Not sent: the user's role on this site cannot change its content.`;
	}
	const missing = features.filter( ( feature ) => ! capabilities.features.has( feature ) );
	if ( missing.length === 0 ) return undefined;
	const offered = await upgradePlans().catch( () => new Map< string, string >() );
	const plans = [ ...offered ]
		.filter( ( [ slug ] ) =>
			missing.every( ( feature ) => capabilities.plansWith[ feature ]?.includes( slug ) )
		)
		.map( ( [ , name ] ) => name );
	const offer = plans.length
		? ` Plans that include ${ missing.length > 1 ? 'them' : 'it' }: ${ [ ...new Set( plans ) ].join(
				', '
		  ) }.`
		: '';
	return `Not sent: this site's ${ capabilities.planName } plan does not include ${ missing.join(
		' and '
	) } (WordPress.com plan features).${ offer }`;
}
