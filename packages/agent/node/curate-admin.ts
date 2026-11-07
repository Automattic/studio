import { randomBytes } from 'crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import {
	CURATE_ADMIN_SITE_PLUGIN,
	getCurateAdminManifestPath,
} from '@studio/common/lib/curate-admin';
import { designSheet, fontFamilyName, parseDesignMd } from '@studio/design-md';
import { z } from 'zod';
import { getSkillPath } from './skills';
import { runWpCli } from './tools/utils';
import type { HostSite, StudioAgentHost } from './host';

export const CURATE_ADMIN_PLUGIN_SLUG = 'curate-admin';

const hexColor = z.string().regex( /^#[0-9a-fA-F]{6}$/, 'must be a six-digit hex color' );
const slug = z
	.string()
	.regex( /^[a-z][a-z0-9_]*$/, 'must be lowercase letters, digits and underscores' );
const kebabId = z.string().regex( /^[a-z][a-z0-9-]*$/, 'must be lowercase kebab-case' );
const adminScreen = z
	.string()
	.regex( /^[a-z-]+\.php(\?\S+)?$/, 'must be a `screen` from inspect_wp_admin, like upload.php' );
const dashicon = z.string().regex( /^dashicons-[a-z0-9-]+$/, 'must be a dashicon' );
const fieldKey = slug
	.max( 32 )
	.refine( ( key ) => key !== 'title', '"title" is built in: use titleLabel to name it' );

const PAGES_SCREEN = 'edit.php?post_type=page';

const menuEntry = z.strictObject( {
	screen: adminScreen,
	label: z.string().min( 1 ).optional(),
	icon: dashicon.optional(),
	promote: z.boolean().optional(),
	hideChildren: z.array( adminScreen ).optional(),
	only: z.array( z.string().min( 1 ) ).min( 1 ).optional(),
	lock: z.literal( 'contentOnly' ).optional(),
} );

const taxonomy = z.union( [
	slug,
	z.strictObject( {
		slug: slug.max( 32 ),
		singular: z.string().min( 1 ),
		plural: z.string().min( 1 ),
		hierarchical: z.boolean().optional(),
		terms: z.array( z.string().min( 1 ) ).optional(),
	} ),
] );

const postType = z.strictObject( {
	slug: slug
		.max( 20 )
		.refine( ( type ) => ! [ 'post', 'page' ].includes( type ), 'must be a new post type' ),
	singular: z.string().min( 1 ),
	plural: z.string().min( 1 ),
	titleLabel: z.string().min( 1 ).optional(),
	icon: dashicon.optional(),
	public: z.boolean().optional(),
	hasArchive: z.boolean().optional(),
	urlSlug: z
		.string()
		.regex( /^[a-z0-9-]+$/ )
		.optional(),
	previewPath: z.string().startsWith( '/' ).optional(),
	supports: z
		.array(
			z.enum( [
				'title',
				'editor',
				'thumbnail',
				'excerpt',
				'author',
				'comments',
				'revisions',
				'page-attributes',
			] )
		)
		.optional(),
	taxonomies: z.array( taxonomy ).optional(),
	fields: z
		.array(
			z.strictObject( {
				key: fieldKey,
				label: z.string().min( 1 ),
				type: z.enum( [ 'text', 'textarea', 'date' ] ),
			} )
		)
		.optional(),
	template: z.array( z.array( z.unknown() ).min( 1 ) ).optional(),
	templateLock: z
		.union( [ z.literal( false ), z.enum( [ 'all', 'insert', 'contentOnly' ] ) ] )
		.optional(),
	blocks: z.array( z.string() ).min( 1 ).optional(),
	order: z
		.strictObject( {
			field: fieldKey,
			direction: z.enum( [ 'asc', 'desc' ] ).optional(),
			upcoming: z.boolean().optional(),
		} )
		.optional(),
} );

const setting = z.strictObject( {
	id: kebabId,
	title: z.string().min( 1 ),
	label: z.string().min( 1 ).optional(),
	icon: dashicon.optional(),
	option: slug,
	previewPath: z.string().startsWith( '/' ).optional(),
	fields: z
		.array(
			z.strictObject( {
				key: fieldKey,
				label: z.string().min( 1 ),
				type: z.enum( [ 'text', 'textarea' ] ),
			} )
		)
		.min( 1 ),
} );

const widgetBase = { id: kebabId, title: z.string().min( 1 ) };
const widget = z.discriminatedUnion( 'type', [
	z.strictObject( {
		...widgetBase,
		type: z.literal( 'links' ),
		links: z
			.array(
				z.strictObject( {
					screen: adminScreen,
					label: z.string().min( 1 ),
					description: z.string().optional(),
				} )
			)
			.min( 1 ),
	} ),
	z.strictObject( {
		...widgetBase,
		type: z.literal( 'recent' ),
		postType: z.string().min( 1 ),
		status: z.string().optional(),
		count: z.number().int().positive().optional(),
	} ),
	z.strictObject( { ...widgetBase, type: z.literal( 'requests' ) } ),
] );

const manifestSchema = z
	.strictObject( {
		brand: z
			.strictObject( {
				name: z.string().min( 1 ).optional(),
				logo: z.string().optional(),
				accent: hexColor.optional(),
				accentText: hexColor.optional(),
				sidebar: hexColor.optional(),
				sidebarText: hexColor.optional(),
				displayFont: z.string().optional(),
			} )
			.optional(),
		agency: z
			.strictObject( {
				name: z.string().min( 1 ),
				email: z.email().optional(),
				url: z.url().optional(),
				responseTime: z.string().optional(),
			} )
			.optional(),
		staff: z
			.strictObject( {
				name: z.string().min( 1 ),
				login: z
					.string()
					.regex( /^[a-z0-9][a-z0-9_-]*$/, 'must be a lowercase login' )
					.optional(),
			} )
			.optional(),
		// Who gets the curated wp-admin: a separate Staff account, or everyone who logs
		// in. No default: guessing would build the wrong thing, and create an account.
		audience: z.enum( [ 'staff', 'everyone' ], {
			error: 'must be "staff" or "everyone", from the answer to the first question',
		} ),
		// Staff, unless the site's own words call for another name.
		role: z
			.strictObject( {
				slug: slug
					.refine(
						( role ) =>
							! [
								'administrator',
								'editor',
								'author',
								'contributor',
								'subscriber',
								'shop_manager',
								'customer',
							].includes( role ),
						'must be a new role, not a built-in one'
					)
					.default( 'staff' ),
				name: z.string().min( 1 ).default( 'Staff' ),
				extends: z
					.enum( [ 'editor', 'author', 'contributor', 'shop_manager' ] )
					.default( 'editor' ),
				remove: z.array( z.string() ).optional(),
				add: z.array( z.string() ).optional(),
			} )
			.prefault( {} ),
		menu: z.strictObject( {
			keep: z.array( menuEntry ).optional(),
			hide: z.array( adminScreen ).optional(),
		} ),
		postTypes: z.array( postType ).optional(),
		settings: z.array( setting ).optional(),
		dashboard: z
			.strictObject( {
				keep: z.array( z.string() ).optional(),
				hide: z.array( z.string() ).optional(),
				welcome: z.boolean().optional(),
				widgets: z.array( widget ).optional(),
			} )
			.optional(),
		guide: z
			.array(
				z.strictObject( {
					id: kebabId,
					title: z.string().min( 1 ),
					screen: adminScreen.optional(),
					steps: z.array( z.string().min( 1 ) ).min( 1 ),
				} )
			)
			.optional(),
		editor: z
			.strictObject( {
				blocks: z.array( z.string() ).min( 1 ).optional(),
				restrict: z.boolean().optional(),
			} )
			.optional(),
		strings: z.record( z.string(), z.string() ).optional(),
	} )
	.superRefine( ( manifest, context ) => {
		const issue = ( message: string, ...at: ( string | number )[] ) =>
			context.addIssue( { code: 'custom', message, path: at } );

		const { keep = [], hide = [] } = manifest.menu;
		// Staff keep what is listed and everyone else's menu loses what is listed, so
		// a plugin added later stays hidden from staff and still appears for everyone.
		if ( manifest.audience === 'staff' ) {
			if ( ! keep.length ) {
				issue( 'a staff account needs menu.keep: the items it keeps', 'menu', 'keep' );
			}
			if ( hide.length ) {
				issue( 'a staff account keeps only menu.keep, so leave out menu.hide', 'menu', 'hide' );
			}
		} else if ( ! hide.length ) {
			issue( 'with everyone, list the items to hide in menu.hide', 'menu', 'hide' );
		}

		const seen = new Set< string >();
		keep.forEach( ( { screen, only, lock }, index ) => {
			if ( seen.has( screen ) ) {
				issue( `duplicate menu item "${ screen }"`, 'menu', 'keep', index, 'screen' );
			}
			seen.add( screen );
			if ( ( only || lock ) && screen !== PAGES_SCREEN ) {
				issue( `only and lock are for ${ PAGES_SCREEN }`, 'menu', 'keep', index );
			}
		} );

		const unique = ( values: string[], name: string, ...at: ( string | number )[] ) => {
			if ( new Set( values ).size !== values.length ) {
				issue( `duplicate ${ name }`, ...at );
			}
		};
		unique(
			( manifest.postTypes ?? [] ).map( ( type ) => type.slug ),
			'post type',
			'postTypes'
		);
		unique(
			( manifest.settings ?? [] ).map( ( { id } ) => id ),
			'settings id',
			'settings'
		);
		unique(
			( manifest.guide ?? [] ).map( ( { id } ) => id ),
			'guide id',
			'guide'
		);
		unique(
			( manifest.dashboard?.widgets ?? [] ).map( ( { id } ) => id ),
			'widget id',
			'dashboard',
			'widgets'
		);

		if (
			manifest.dashboard?.widgets?.some( ( { type } ) => type === 'requests' ) &&
			! manifest.agency
		) {
			issue( 'a requests widget needs an agency to send them to', 'dashboard', 'widgets' );
		}

		manifest.postTypes?.forEach( ( type, index ) => {
			const orderField = type.fields?.find( ( { key } ) => key === type.order?.field );
			if ( type.order && ! orderField ) {
				issue( `order.field must be one of this post type's fields`, 'postTypes', index, 'order' );
			}
			if ( type.order?.upcoming && orderField?.type !== 'date' ) {
				issue( 'order.upcoming needs a date field', 'postTypes', index, 'order' );
			}
			if (
				( type.fields?.length || type.template ) &&
				type.supports?.includes( 'editor' ) === false
			) {
				issue( 'fields and templates live in the editor: add it to supports', 'postTypes', index );
			}
			// Without either, nothing can confirm that its items reach the site.
			if ( ! type.public && ! type.previewPath ) {
				issue(
					'a post type with no URLs needs previewPath: the page that shows it',
					'postTypes',
					index
				);
			}
			if ( type.hasArchive && ! type.public ) {
				issue( 'an archive needs public: true', 'postTypes', index, 'hasArchive' );
			}
		} );

		// Without the publish capability, the editor turns saving a live page into
		// "Submit for Review", which takes that page offline.
		const removed = manifest.role.remove ?? [];
		if ( seen.has( PAGES_SCREEN ) && removed.includes( 'publish_pages' ) ) {
			issue( 'keep publish_pages: staff edit live pages', 'role', 'remove' );
		}
		if ( seen.has( 'edit.php' ) && removed.includes( 'publish_posts' ) ) {
			issue( 'keep publish_posts: staff publish posts', 'role', 'remove' );
		}
	} );

export type CurateAdminManifest = z.infer< typeof manifestSchema >;

export function parseCurateAdminManifest( input: unknown ): CurateAdminManifest {
	const result = manifestSchema.safeParse( input );
	if ( ! result.success ) {
		const problems = result.error.issues.map(
			( { path: at, message } ) => `- ${ at.join( '.' ) || 'manifest' }: ${ message }`
		);
		throw new Error( `The curated admin manifest is invalid:\n${ problems.join( '\n' ) }` );
	}
	return result.data;
}

function channel( hex: string, offset: number ): number {
	return parseInt( hex.slice( offset, offset + 2 ), 16 );
}

function relativeLuminance( hex: string ): number {
	const [ red, green, blue ] = [ 1, 3, 5 ].map( ( offset ) => {
		const value = channel( hex, offset ) / 255;
		return value <= 0.03928 ? value / 12.92 : ( ( value + 0.055 ) / 1.055 ) ** 2.4;
	} );
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const textOn = ( background: string ) =>
	relativeLuminance( background ) > 0.36 ? '#17211c' : '#ffffff';

// The sidebar is a dark shade of the accent, so white text stays readable on it
// whatever color the site's design uses.
function sidebarShade( accent: string ): string {
	if ( relativeLuminance( accent ) < 0.08 ) {
		return accent;
	}
	const shade = ( offset: number ) =>
		Math.round( channel( accent, offset ) * 0.55 )
			.toString( 16 )
			.padStart( 2, '0' );
	return `#${ shade( 1 ) }${ shade( 3 ) }${ shade( 5 ) }`;
}

// Fills in whatever the manifest's brand leaves out from the site's DESIGN.md.
async function resolveBrand(
	site: HostSite,
	brand: CurateAdminManifest[ 'brand' ]
): Promise< NonNullable< CurateAdminManifest[ 'brand' ] > > {
	let design: { accent?: string; displayFont?: string } = {};
	try {
		const sheet = designSheet(
			parseDesignMd( await readFile( path.join( site.path, 'DESIGN.md' ), 'utf8' ) )
		);
		design = {
			accent: /^#[0-9a-f]{6}$/i.test( sheet.primary ) ? sheet.primary : undefined,
			displayFont: fontFamilyName( sheet.display.fontFamily ) || undefined,
		};
	} catch {
		// No usable design system: the curated admin keeps its neutral defaults.
	}

	const accent = brand?.accent ?? design.accent;
	const sidebar = brand?.sidebar ?? ( accent && sidebarShade( accent ) );
	return {
		displayFont: design.displayFont,
		...( accent && { accent, accentText: textOn( accent ) } ),
		...( sidebar && { sidebar, sidebarText: textOn( sidebar ) } ),
		...brand,
	};
}

function renderSitePlugin( name: string ): string {
	const pluginName = name.replace( /[\r\n*]/g, ' ' ).trim();
	return `<?php
/**
 * Plugin Name:      ${ pluginName } curated admin
 * Description:      This site's curated admin: its manifest and guide. Written by WordPress Studio.
 * Version:          1.0.0
 * Requires Plugins: ${ CURATE_ADMIN_PLUGIN_SLUG }
 * License:          GPLv2 or later
 *
 * @package CurateAdmin
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'curate_admin_manifest_file',
	static function () {
		return __DIR__ . '/curate-admin.json';
	}
);

add_filter(
	'curate_admin_guide',
	static function () {
		return array(
			'path' => __DIR__ . '/guide',
			'url'  => plugins_url( 'guide', __FILE__ ),
		);
	}
);

add_filter(
	'curate_admin_templates_directory',
	static function () {
		return __DIR__ . '/templates';
	}
);
`;
}

export function getSitePluginPath( site: HostSite ): string {
	return path.join( site.path, 'wp-content', 'plugins', CURATE_ADMIN_SITE_PLUGIN );
}

export async function readInstalledManifest( site: HostSite ): Promise< CurateAdminManifest > {
	const file = getCurateAdminManifestPath( site.path );
	return parseCurateAdminManifest( JSON.parse( await readFile( file, 'utf8' ) ) );
}

// The English strings of the runtime, which `manifest.strings` translates for a
// site that isn't in English.
async function getRuntimeStrings(): Promise< string[] > {
	const runtime = getSkillPath( 'curate-admin', 'plugin' );
	const sources = await Promise.all(
		[
			'assets/editor.js',
			'includes/access.php',
			'includes/content.php',
			'includes/dashboard.php',
			'includes/editor.php',
			'includes/requests.php',
		].map( ( file ) => readFile( path.join( runtime, file ), 'utf8' ) )
	);
	const strings = new Set< string >();
	for ( const source of sources ) {
		const pattern = /(["'`])((?:\\.|(?!\1).)+)\1\s*,\s*["'`]curate-admin["'`]/g;
		for ( const [ , , text ] of source.matchAll( pattern ) ) {
			strings.add( text.replace( /\\(.)/g, '$1' ) );
		}
	}
	return [ ...strings ];
}

// The account Studio's "Staff admin" opens. Exports and pushes leave users
// behind, so it stays on this computer and needs no real email or known password.
async function ensureStaffAccount(
	host: StudioAgentHost,
	site: HostSite,
	staff: { name: string; login: string },
	role: string
): Promise< void > {
	const { exitCode, stdout } = await host.sites.wpCli( site, [
		'user',
		'get',
		staff.login,
		'--field=roles',
	] );
	if ( exitCode === 0 ) {
		// "staff" is a likely login on any site, and it could be someone real.
		if ( ! stdout.split( /[\s,]+/ ).includes( role ) ) {
			throw new Error(
				`The user "${
					staff.login
				}" already exists with the role ${ stdout.trim() }. Set staff.login to another name.`
			);
		}
		return;
	}
	await runWpCli( host, site, [
		'user',
		'create',
		staff.login,
		`${ staff.login }@staff.invalid`,
		`--role=${ role }`,
		`--first_name=${ staff.name.split( ' ' )[ 0 ] }`,
		`--display_name=${ staff.name }`,
		`--user_pass=${ randomBytes( 24 ).toString( 'hex' ) }`,
	] );
}

// Going from a Staff account to everyone: nothing should still point at them.
async function removeStaffAccount(
	host: StudioAgentHost,
	site: HostSite,
	login: string,
	role: string
): Promise< void > {
	const owner = (
		await runWpCli( host, site, [
			'user',
			'list',
			'--role=administrator',
			'--field=ID',
			'--number=1',
		] )
	).trim();
	await host.sites.wpCli( site, [ 'user', 'delete', login, `--reassign=${ owner }`, '--yes' ] );
	await host.sites.wpCli( site, [ 'role', 'delete', role ] );
}

type InstalledManifest = Omit< CurateAdminManifest, 'role' > & {
	role?: CurateAdminManifest[ 'role' ];
	staff?: { name: string; login: string };
};

export interface CuratedAdminInstallResult {
	manifest: InstalledManifest;
	locale: string;
	untranslated: string[];
}

export async function installCuratedAdmin(
	host: StudioAgentHost,
	site: HostSite,
	input: unknown
): Promise< CuratedAdminInstallResult > {
	const parsed = parseCurateAdminManifest( input );
	if ( ! ( await host.sites.isRunning( site ) ) ) {
		throw new Error( 'The site is not running. Start it with site_start first.' );
	}

	const pagesEntry = parsed.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
	if ( pagesEntry?.only ) {
		const slugs = (
			await runWpCli( host, site, [
				'post',
				'list',
				'--post_type=page',
				'--post_status=publish,draft,private',
				'--field=post_name',
			] )
		)
			.split( '\n' )
			.map( ( pageSlug ) => pageSlug.trim() );
		const missing = pagesEntry.only.filter( ( pageSlug ) => ! slugs.includes( pageSlug ) );
		if ( missing.length ) {
			throw new Error( `These pages don't exist on the site: ${ missing.join( ', ' ) }.` );
		}
	}

	const previous = await readInstalledManifest( site ).catch( () => null );
	// wp-admin keeps its own colors unless the manifest asks for the site's brand.
	const brand =
		parsed.brand && ( await resolveBrand( site, { name: site.name, ...parsed.brand } ) );
	const { role, staff, brand: _brand, ...shared } = parsed;
	const manifest: InstalledManifest =
		parsed.audience === 'everyone'
			? { ...shared, ...( brand && { brand } ) }
			: {
					...parsed,
					...( brand && { brand } ),
					staff: {
						name: staff?.name ?? role.name,
						login: staff?.login ?? role.slug.replace( /_/g, '-' ),
					},
			  };

	const pluginsPath = path.join( site.path, 'wp-content', 'plugins' );
	const runtimePath = path.join( pluginsPath, CURATE_ADMIN_PLUGIN_SLUG );
	await rm( runtimePath, { recursive: true, force: true } );
	await cp( getSkillPath( 'curate-admin', 'plugin' ), runtimePath, { recursive: true } );

	const sitePluginPath = getSitePluginPath( site );
	await mkdir( path.join( sitePluginPath, 'guide' ), { recursive: true } );
	await mkdir( path.join( sitePluginPath, 'templates' ), { recursive: true } );
	await writeFile(
		path.join( sitePluginPath, `${ CURATE_ADMIN_SITE_PLUGIN }.php` ),
		renderSitePlugin( brand?.name ?? site.name )
	);
	await writeFile(
		getCurateAdminManifestPath( site.path ),
		JSON.stringify( manifest, null, '\t' ) + '\n'
	);

	await runWpCli( host, site, [
		'plugin',
		'activate',
		CURATE_ADMIN_PLUGIN_SLUG,
		CURATE_ADMIN_SITE_PLUGIN,
	] );

	const postTypes = ( parsed.postTypes ?? [] ).map( ( type ) => `'${ type.slug }'` ).join( ',' );
	const taken = (
		await runWpCli( host, site, [
			'eval',
			`foreach ( array( ${ postTypes } ) as $type ) { $object = get_post_type_object( $type ); if ( $object && empty( $object->curate_admin ) ) { echo $type, ' '; } }`,
		] )
	).trim();
	if ( taken ) {
		throw new Error(
			`These post types already exist, so they can't be redefined here: ${ taken }. Keep their menu items in menu.keep instead.`
		);
	}

	if ( manifest.staff ) {
		await ensureStaffAccount( host, site, manifest.staff, parsed.role.slug );
	} else if ( previous?.audience === 'staff' && previous.staff?.login ) {
		await removeStaffAccount( host, site, previous.staff.login, previous.role.slug );
	}

	const locale = ( await runWpCli( host, site, [ 'eval', 'echo get_locale();' ] ) ).trim();
	const strings = locale.startsWith( 'en' ) ? [] : await getRuntimeStrings();
	return {
		manifest,
		locale,
		untranslated: strings.filter( ( text ) => ! manifest.strings?.[ text ] ),
	};
}
