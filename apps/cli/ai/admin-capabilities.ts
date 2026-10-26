/**
 * The capabilities the administrator role grants that the site's code takes
 * from its administrator. WordPress resolves a capability through
 * map_meta_cap() and the user_has_cap filter (wp-includes/capabilities.php),
 * which plugins and themes extend, so code that maps a capability to
 * do_not_allow denies it to every user and every screen that checks it. A
 * post type that names a primitive capability, such as edit_posts, as its
 * edit_post, read_post or delete_post makes WordPress map that capability as
 * the meta capability for every check (_post_type_meta_capabilities() in
 * wp-includes/post.php). The meta capabilities a post type names from its own
 * capability_type (get_post_type_capabilities()) need a post by design, so a
 * role that holds them, as WooCommerce gives the administrator edit_product,
 * is not reported.
 *
 * When the PHP of a site's active plugins or themes changes, or the plugins and theme active change, Studio asks WordPress
 * which of the role's capabilities user_can() denies the first administrator,
 * with the site's code loaded and with its plugins and themes skipped: the
 * ones denied only with the code loaded are the code's.
 *
 * In the same runs, and one with only the changed plugins or theme skipped,
 * Studio states what the changed code registers with WordPress: what the
 * registries hold only with it loaded.
 */
import { activeCode } from 'cli/ai/active-code';
import { runWpCli } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

const KEY = 'administrator capabilities';

// The registries a plugin or theme adds to, by the function that adds to each.
const REGISTRIES: Record< string, string > = {
	'post types': 'register_post_type()',
	taxonomies: 'register_taxonomy()',
	'REST routes': 'register_rest_route()',
	'block types': 'register_block_type()',
	abilities: 'wp_register_ability(), in wp-includes/abilities-api.php',
	shortcodes: 'add_shortcode()',
};

const REGISTERED = `echo 'REGISTERED=' . wp_json_encode( array(
	'post types'  => array_keys( get_post_types() ),
	'taxonomies'  => array_keys( get_taxonomies() ),
	'REST routes' => array_keys( rest_get_server()->get_routes() ),
	'block types' => array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() ),
	'abilities'   => function_exists( 'wp_get_abilities' ) ? array_map( function ( $ability ) { return $ability->get_name(); }, array_values( wp_get_abilities() ) ) : array(),
	'shortcodes'  => array_keys( $GLOBALS['shortcode_tags'] ),
) ) . "\\n";
echo 'OUT_OF_REST=' . wp_json_encode( array(
	'post types' => array_keys( get_post_types( array( 'show_in_rest' => false ) ) ),
	'taxonomies' => array_keys( get_taxonomies( array( 'show_in_rest' => false ) ) ),
	'abilities'  => function_exists( 'wp_get_abilities' ) ? array_values( array_filter( array_map( function ( $ability ) { return $ability->get_meta_item( 'show_in_rest' ) ? null : $ability->get_name(); }, array_values( wp_get_abilities() ) ) ) ) : array(),
) ) . "\\n";`;

// The setting that keeps a registry's item out of WordPress's REST API, which
// is how agents and the block editor reach it.
const IN_REST: Record< string, string > = {
	'post types': 'show_in_rest false',
	taxonomies: 'show_in_rest false',
	abilities:
		'meta show_in_rest false, so not listed by wp-includes/rest-api/endpoints/class-wp-rest-abilities-v1-list-controller.php',
};

type Registered = Record< string, string[] >;

interface Denied {
	user: number;
	caps: Record< string, { mapped: string[]; types: Array< [ string, string ] > } >;
}

const DENIED = `global $post_type_meta_caps;
$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID', 'orderby' => 'ID' ) );
$role = get_role( 'administrator' );
$denied = array( 'user' => $admins ? (int) $admins[0] : 0, 'caps' => new stdClass() );
foreach ( $admins && $role ? array_keys( array_filter( $role->capabilities ) ) : array() as $cap ) {
	if ( user_can( $denied['user'], $cap ) ) {
		continue;
	}
	$types = array();
	$own   = false;
	foreach ( isset( $post_type_meta_caps[ $cap ] ) ? get_post_types( array( 'map_meta_cap' => true ), 'objects' ) : array() as $type ) {
		foreach ( array( 'read_post', 'edit_post', 'delete_post' ) as $meta ) {
			if ( $type->cap->$meta === $cap ) {
				// The meta capability get_post_type_capabilities() names from the
				// type's capability_type, as WooCommerce's edit_product, needs a post
				// by design, whatever roles hold its name.
				$singular = ( (array) $type->capability_type )[0];
				$own      = $own || $cap === str_replace( '_post', '_' . $singular, $meta );
				$types[]  = array( $type->name, $meta );
			}
		}
	}
	if ( $own ) {
		continue;
	}
	$denied['caps']->$cap = array( 'mapped' => map_meta_cap( $cap, $denied['user'] ), 'types' => $types );
}
echo 'DENIED_CAPS=' . wp_json_encode( $denied );`;

// What WordPress prints after a marker, on its line.
const printed = ( output: string, marker: string ) =>
	JSON.parse( output.slice( output.indexOf( marker ) + marker.length ).split( '\n' )[ 0 ] );

async function askWordPress(
	site: SiteData,
	skip: string[]
): Promise< { denied: Denied; registered: Registered; outOfRest: Registered } > {
	const output = await runWpCli( site, [ 'eval', REGISTERED + DENIED, ...skip ] );
	return {
		denied: printed( output, 'DENIED_CAPS=' ),
		registered: printed( output, 'REGISTERED=' ),
		outOfRest: printed( output, 'OUT_OF_REST=' ),
	};
}

// The site's active code, by plugin and theme: which are active, and their
// PHP files. Must-use plugins load with plugins skipped too.
async function readVersions( sitePath: string ): Promise< Versions > {
	return activeCode( sitePath, ( name ) => name.endsWith( '.php' ) );
}

// The WP-CLI flags that skip the given plugins and themes: a plugin by its
// folder, or a single-file plugin by its name (WP_CLI\Utils\get_plugin_name()).
function skipping( keys: string[] ): string[] {
	const plugins = keys
		.filter( ( key ) => key.startsWith( 'plugin ' ) )
		.map( ( key ) =>
			key
				.slice( 'plugin '.length )
				.split( '/' )[ 0 ]
				.replace( /\.php$/, '' )
		);
	return [
		...( plugins.length ? [ `--skip-plugins=${ plugins.join( ',' ) }` ] : [] ),
		...( keys.some( ( key ) => key.startsWith( 'theme ' ) ) ? [ '--skip-themes' ] : [] ),
	];
}

const list = ( items: string[] ) =>
	items.length < 2
		? items.join( '' )
		: `${ items.slice( 0, -1 ).join( ', ' ) } and ${ items.at( -1 ) }`;

const MAX_NAMES = 12;

function describeRegistered(
	site: SiteData,
	changed: string[],
	added: Registered,
	outOfRest: Registered
): string {
	const names = ( items: string[] ) =>
		items.length > MAX_NAMES
			? `${ items.slice( 0, MAX_NAMES ).join( ', ' ) } and ${ items.length - MAX_NAMES } more`
			: items.join( ', ' );
	const holds = Object.keys( REGISTRIES ).filter( ( registry ) => added[ registry ]?.length );
	const none = Object.keys( REGISTRIES ).filter( ( registry ) => ! added[ registry ]?.length );
	return `${ site.name }: with ${ list( changed ) } loaded, WordPress registers ${ [
		...holds.map( ( registry ) => {
			const hidden = added[ registry ].filter(
				( name ) => outOfRest[ registry ]?.includes( name )
			);
			return `${ registry } ${ names( added[ registry ] ) } (${ REGISTRIES[ registry ] }${
				hidden.length
					? `; with ${ IN_REST[ registry ] }, out of the REST API: ${ names( hidden ) }`
					: ''
			})`;
		} ),
		...( none.length
			? [
					`no ${ list(
						none.map( ( registry ) => `${ registry } (${ REGISTRIES[ registry ] })` )
					) } of its own`,
			  ]
			: [] ),
	].join( '; ' ) }.`;
}

function describeDenied( site: SiteData, user: number, denied: Denied[ 'caps' ] ): string {
	const caps = Object.keys( denied );
	const mapped = [ ...new Set( caps.flatMap( ( cap ) => denied[ cap ].mapped ) ) ];
	const byType = new Map< string, string[] >();
	for ( const cap of caps ) {
		for ( const [ type, meta ] of denied[ cap ].types ) {
			byType.set( type, [ ...( byType.get( type ) ?? [] ), `${ cap } as its ${ meta }` ] );
		}
	}
	const them = caps.length === 1 ? 'it' : 'them';
	return [
		`${ site.name }: user_can() denies its administrator (user ${ user }) ${ list(
			caps
		) }, which the administrator role grants and WordPress grants with the site's plugins and theme skipped; map_meta_cap() (wp-includes/capabilities.php) maps ${ them } to ${ list(
			mapped
		) }.`,
		...[ ...byType ].map(
			( [ type, named ] ) =>
				`Post type ${ type } names ${ list( named ) } capability, so WordPress checks ${
					named.length === 1
						? 'that capability as the meta capability, which needs'
						: 'those capabilities as the meta capabilities, which need'
				} a post (_post_type_meta_capabilities() in wp-includes/post.php).`
		),
		...( byType.size
			? [
					"register_post_type()'s capability_type names a post type's capabilities from its own name, as core's page post type has edit_page and edit_pages.",
			  ]
			: [] ),
	].join( ' ' );
}

export const adminCapabilities: SiteChangeSource = {
	name: 'admin-capabilities',
	read: readVersions,
	async check( site, before, after ) {
		const changed = Object.keys( after ).filter( ( key ) => before[ key ] !== after[ key ] );
		const removed = Object.keys( before ).some( ( key ) => ! ( key in after ) );
		if ( ! changed.length && ! removed ) {
			return { reports: [] };
		}
		let withCode: Awaited< ReturnType< typeof askWordPress > >;
		let core: Awaited< ReturnType< typeof askWordPress > >;
		let without: Awaited< ReturnType< typeof askWordPress > >;
		try {
			await connectToDaemon();
			withCode = await askWordPress( site, [] );
			core = await askWordPress( site, [ '--skip-plugins', '--skip-themes' ] );
			without = changed.length ? await askWordPress( site, skipping( changed ) ) : withCode;
		} catch {
			// Code that does not load is reported by what runs it.
			return { reports: [] };
		} finally {
			await disconnectFromDaemon();
		}
		const denied = Object.fromEntries(
			Object.entries( withCode.denied.caps ).filter( ( [ cap ] ) => ! ( cap in core.denied.caps ) )
		);
		const added = Object.fromEntries(
			Object.entries( withCode.registered ).map( ( [ registry, names ] ) => [
				registry,
				names.filter( ( name ) => ! without.registered[ registry ]?.includes( name ) ),
			] )
		);
		return {
			reports: [
				{
					key: KEY,
					problem: Object.keys( denied ).length
						? describeDenied( site, withCode.denied.user, denied )
						: undefined,
				},
				...( changed.length
					? [
							{
								key: 'registered',
								summary: describeRegistered( site, changed, added, withCode.outOfRest ),
							},
					  ]
					: [] ),
			],
		};
	},
};
