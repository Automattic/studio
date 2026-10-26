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
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from 'cli/ai/site-database';
import { runWpCli } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

const KEY = 'administrator capabilities';

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

async function deniedCaps( site: SiteData, skipCode: boolean ): Promise< Denied > {
	const output = await runWpCli( site, [
		'eval',
		DENIED,
		...( skipCode ? [ '--skip-plugins', '--skip-themes' ] : [] ),
	] );
	const json = output.slice( output.indexOf( 'DENIED_CAPS=' ) + 'DENIED_CAPS='.length );
	return JSON.parse( json ) as Denied;
}

async function phpFiles( dir: string ): Promise< string[] > {
	const entries = await readdir( dir, { recursive: true, withFileTypes: true } ).catch( () => [] );
	return Promise.all(
		entries
			.filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.php' ) )
			.map( async ( entry ) => {
				const file = path.join( entry.parentPath, entry.name );
				const { mtimeMs, size } = await stat( file ).catch( () => ( { mtimeMs: 0, size: -1 } ) );
				return `${ path.relative( dir, file ) }:${ mtimeMs }:${ size }`;
			} )
	);
}

// The site's active code, as one version: which plugins and themes are
// active, and their PHP files. Must-use plugins load with plugins skipped too.
async function readVersions( sitePath: string ): Promise< Versions > {
	const content = path.join( sitePath, 'wp-content' );
	const active = await readWordPressSite( sitePath, ( site ) => {
		const plugins = site.option( 'active_plugins' );
		return {
			plugins: plugins && typeof plugins === 'object' ? Object.values( plugins ).map( String ) : [],
			themes: [ ...new Set( [ site.option( 'template' ), site.option( 'stylesheet' ) ] ) ].filter(
				( theme ): theme is string => typeof theme === 'string' && theme !== ''
			),
		};
	} );
	const dirs = [
		...active.plugins
			.filter( ( plugin ) => plugin.includes( '/' ) )
			.map( ( plugin ) => path.join( content, 'plugins', path.dirname( plugin ) ) ),
		...active.themes.map( ( theme ) => path.join( content, 'themes', theme ) ),
	];
	const singleFiles = await Promise.all(
		active.plugins
			.filter( ( plugin ) => ! plugin.includes( '/' ) )
			.map( ( plugin ) =>
				stat( path.join( content, 'plugins', plugin ) ).then(
					( { mtimeMs, size } ) => `${ plugin }:${ mtimeMs }:${ size }`,
					() => plugin
				)
			)
	);
	const files = await Promise.all( dirs.map( phpFiles ) );
	return {
		code: JSON.stringify( [
			active,
			singleFiles,
			files.map( ( dirFiles ) => dirFiles.sort().join( '|' ) ),
		] ),
	};
}

const list = ( items: string[] ) =>
	items.length < 2
		? items.join( '' )
		: `${ items.slice( 0, -1 ).join( ', ' ) } and ${ items.at( -1 ) }`;

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
		if ( before.code === after.code ) {
			return { reports: [] };
		}
		let withCode: Denied;
		let core: Denied;
		try {
			await connectToDaemon();
			withCode = await deniedCaps( site, false );
			core = await deniedCaps( site, true );
		} catch {
			// Code that does not load is reported by what runs it.
			return { reports: [] };
		} finally {
			await disconnectFromDaemon();
		}
		const denied = Object.fromEntries(
			Object.entries( withCode.caps ).filter( ( [ cap ] ) => ! ( cap in core.caps ) )
		);
		return {
			reports: [
				{
					key: KEY,
					problem: Object.keys( denied ).length
						? describeDenied( site, withCode.user, denied )
						: undefined,
				},
			],
		};
	},
};
