/**
 * A copy of the content of each post WordPress renders, as a file in Studio's
 * workspace for the site, outside the site's folder so it never travels with
 * the site: <config>/workspace/<site id>/<post type>/<ID>.html.
 *
 * A change to a copy, by any tool or script, is saved to its post as an
 * administrator's save in the editor saves it (savePost() in
 * site-markup.ts), which then checks it as it checks any saved post. A
 * change to a post, in the editor or by any route, rewrites its copy. When a
 * copy and its post both changed, the post stands: the copy is rewritten from
 * it, and the copy's change is kept in <ID>.unsaved.html.
 *
 * The active block theme's Global Styles (the wp_global_styles post WordPress
 * merges over its theme.json) are copied as wp_global_styles/<theme>.json,
 * holding what the Site Editor starts them with when none are saved yet, and
 * saved as the Site Editor saves them (saveGlobalStyles()).
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { RENDERED, RENDERED_TYPES, savePost } from '@studio/agent/node/site-markup';
import { activeThemes } from '@studio/agent/node/themes';
import { runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';
import type { WordPressSite } from '@studio/agent/node/site-database';

const MANIFEST = '.copies.json';

// Each copy's post version and content hash when Studio last wrote or saved it.
type Manifest = Record< string, { type: string; post: string; file: string } >;

interface Post {
	// The post's ID; for Global Styles, the theme they are saved for.
	id: number | string;
	type: string;
	version: string;
	// Global Styles' post, once one is saved.
	post?: number;
}

export function workspaceRoot(): string {
	return path.join( getConfigDirectory(), 'workspace' );
}

const workspaceOfSite = ( siteId: string ) => path.join( workspaceRoot(), siteId );

async function workspaceOf(
	host: StudioAgentHost,
	sitePath: string
): Promise< string | undefined > {
	const site = await host.sites.findByFolder( sitePath );
	return site?.id ? workspaceOfSite( site.id ) : undefined;
}

/** The ID of the site whose workspace holds `file`, if one does. */
export function siteIdOfCopy( file: string ): string | undefined {
	const relative = path.relative( workspaceRoot(), path.resolve( file ) );
	const [ id ] = relative.split( path.sep );
	return id && ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) ? id : undefined;
}

const hash = ( content: string ) => createHash( 'sha1' ).update( content ).digest( 'hex' );

const GLOBAL_STYLES = 'wp_global_styles';

const copyOf = ( workspace: string, post: Pick< Post, 'id' | 'type' > ) =>
	path.join(
		workspace,
		post.type,
		`${ post.id }.${ post.type === GLOBAL_STYLES ? 'json' : 'html' }`
	);

// The content WordPress gives a theme's Global Styles post when it makes one
// (WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles()).
const NO_GLOBAL_STYLES = '{"version": 3, "isGlobalStylesUserThemeJSON": true }';

const VERSION = `post_modified_gmt || ' ' || length(post_content)`;

function readPosts( site: WordPressSite ): Post[] {
	const posts = site.query< Post >(
		`SELECT ID AS id, post_type AS type, ${ VERSION } AS version
		FROM ${ site.prefix }posts WHERE ${ RENDERED }`,
		...RENDERED_TYPES
	);
	const styles = globalStyles( site );
	return styles ? [ ...posts, styles ] : posts;
}

// The active block theme's Global Styles: the latest published post its
// wp_theme term names, as WP_Theme_JSON_Resolver reads them.
function globalStyles( site: WordPressSite ): Post | undefined {
	const [ theme ] = activeThemes( site );
	if (
		! theme ||
		! existsSync( path.join( site.root, 'wp-content/themes', theme, 'templates/index.html' ) )
	) {
		return undefined;
	}
	const [ saved ] = site.query< { post: number; version: string } >(
		`SELECT p.ID AS post, ${ VERSION } AS version FROM ${ site.prefix }posts p
		JOIN ${ site.prefix }term_relationships tr ON tr.object_id = p.ID
		JOIN ${ site.prefix }term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
		JOIN ${ site.prefix }terms t ON t.term_id = tt.term_id
		WHERE p.post_type = ? AND p.post_status = 'publish' AND t.name = ?
		ORDER BY p.post_date DESC, p.ID DESC LIMIT 1`,
		GLOBAL_STYLES,
		theme
	);
	return { id: theme, type: GLOBAL_STYLES, version: saved?.version ?? 'none', post: saved?.post };
}

/**
 * Saves a theme's Global Styles from their copy as the Site Editor saves them,
 * as an administrator: it makes the theme's post when there is none yet
 * (WP_Theme_JSON_Resolver::get_user_global_styles_post_id()), then PUTs the
 * copy's styles and settings to /wp/v2/global-styles/<ID>, whose controller
 * keeps isGlobalStylesUserThemeJSON and the schema version and validates
 * custom CSS (WP_REST_Global_Styles_Controller::prepare_item_for_database()).
 * What the copy leaves out, it clears.
 */
async function saveGlobalStyles(
	host: StudioAgentHost,
	site: HostSite,
	theme: string,
	file: string
): Promise< void > {
	const php = `$data = json_decode( file_get_contents( ${ JSON.stringify( file ) } ), true );
if ( ! is_array( $data ) ) { fwrite( STDERR, 'it is not a JSON object: ' . json_last_error_msg() ); exit( 1 ); }
if ( get_stylesheet() !== ${ JSON.stringify( theme ) } ) { fwrite( STDERR, ${ JSON.stringify(
		`${ theme } is not the active theme`
	) } ); exit( 1 ); }
$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
wp_set_current_user( $admins ? (int) $admins[0] : 0 );
$request = new WP_REST_Request( 'PUT', '/wp/v2/global-styles/' . WP_Theme_JSON_Resolver::get_user_global_styles_post_id() );
$request->set_param( 'styles', $data['styles'] ?? array() );
$request->set_param( 'settings', $data['settings'] ?? array() );
$response = rest_do_request( $request );
if ( $response->is_error() ) { fwrite( STDERR, $response->as_error()->get_error_message() ); exit( 1 ); }`;
	await runWpCli( host, site, [ 'eval', php ] );
}

function readContent( site: WordPressSite, post: Post | undefined ): string {
	if ( post?.type === GLOBAL_STYLES && ! post.post ) {
		return NO_GLOBAL_STYLES;
	}
	const id = post?.post ?? post?.id;
	if ( id === undefined ) {
		return '';
	}
	return (
		site.query< { content: string } >(
			`SELECT post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
			id
		)[ 0 ]?.content ?? ''
	);
}

async function readManifest( workspace: string ): Promise< Manifest > {
	return JSON.parse(
		await readFile( path.join( workspace, MANIFEST ), 'utf8' ).catch( () => '{}' )
	);
}

async function writeCopy( file: string, content: string ): Promise< void > {
	mkdirSync( path.dirname( file ), { recursive: true } );
	await writeFile( file, content, 'utf8' );
}

async function readCopy( file: string ): Promise< string | undefined > {
	return readFile( file, 'utf8' ).catch( () => undefined );
}

/**
 * The workspace folder of the site at `sitePath`, which Studio fills with its
 * posts' copies from the next check on. Undefined for a folder Studio doesn't
 * manage.
 */
async function openWorkspace(
	host: StudioAgentHost,
	sitePath: string
): Promise< string | undefined > {
	const workspace = await workspaceOf( host, sitePath );
	if ( workspace ) {
		mkdirSync( workspace, { recursive: true } );
	}
	return workspace;
}

// Stated, and the workspace opened, for a site with posts to copy.
export async function postCopiesFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	if ( ! readPosts( site ).length ) {
		return undefined;
	}
	const workspace = await openWorkspace( host, site.root );
	return workspace
		? `Post content, as WordPress saves it: ${ workspace }/<post type>/<ID>.html, for ${ RENDERED_TYPES.join(
				', '
		  ) }, and ${ workspace }/${ GLOBAL_STYLES }/<theme>.json for the active block theme's Global Styles, which WordPress merges over its theme.json. Studio saves a change to one to its post as the editor saves it (wp_update_post(), or PUT /wp/v2/global-styles for Global Styles), and rewrites it when the post changes.`
		: undefined;
}

const PAGES_INDEX = 'pages.tsv';

// A page's address on the site, as get_permalink() builds it before plugins
// filter it (_get_page_link() in wp-includes/link-template.php): the homepage
// Reading picks at the site's root; with pretty permalinks, a page anyone or an
// administrator can view at its slug under its parents' (get_page_uri()), with
// a trailing slash when the structure ends in one; any other at ?page_id.
function pageAddresses( site: WordPressSite ): string[][] {
	const pages = site.query< {
		id: number;
		parent: number;
		slug: string;
		status: string;
		title: string;
	} >(
		`SELECT ID AS id, post_parent AS parent, post_name AS slug, post_status AS status, post_title AS title
		FROM ${ site.prefix }posts WHERE post_type = 'page' AND post_status NOT IN ('auto-draft', 'inherit', 'trash')
		ORDER BY ID`
	);
	const byId = new Map( pages.map( ( page ) => [ page.id, page ] ) );
	const structure = String( site.option( 'permalink_structure' ) ?? '' );
	const front =
		site.option( 'show_on_front' ) === 'page' ? Number( site.option( 'page_on_front' ) ) : 0;
	const uri = ( page: ( typeof pages )[ number ] ): string => {
		const parent = byId.get( page.parent );
		return parent?.slug ? `${ uri( parent ) }/${ page.slug }` : page.slug;
	};
	const address = ( page: ( typeof pages )[ number ] ) => {
		if ( page.id === front ) {
			return '/';
		}
		if ( ! structure || ! [ 'publish', 'private' ].includes( page.status ) ) {
			return `/?page_id=${ page.id }`;
		}
		return `/${ uri( page ) }${ structure.endsWith( '/' ) ? '/' : '' }`;
	};
	return pages.map( ( page ) => [
		String( page.id ),
		page.status,
		page.slug,
		address( page ),
		page.title.replace( /\s+/g, ' ' ),
	] );
}

/**
 * Site fact: how many pages the site has, with the index Studio keeps of them
 * in its workspace, one line each, so the fact reads the same at any number.
 */
export async function pagesFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	const pages = pageAddresses( site );
	const workspace = pages.length ? await openWorkspace( host, site.root ) : undefined;
	if ( ! workspace ) {
		return undefined;
	}
	const index = path.join( workspace, PAGES_INDEX );
	const content = [ [ 'ID', 'status', 'slug', 'address', 'title' ], ...pages ]
		.map( ( row ) => row.join( '\t' ) )
		.join( '\n' );
	if ( ( await readCopy( index ) ) !== `${ content }\n` ) {
		await writeFile( index, `${ content }\n`, 'utf8' );
	}
	return `Pages: ${ pages.length }; each one's ID, status, slug, address on the site and title are in ${ index }, one per line.`;
}

export const postCopies: SiteChangeSource = {
	name: 'post copies',
	saves: true,
	// Writes the copy of each post that has none, or whose post changed while
	// the copy did not, and returns each post's version and its copy's hash.
	async read( sitePath, _last, host ) {
		const workspace = await workspaceOf( host, sitePath );
		if ( ! workspace || ! existsSync( workspace ) ) {
			return {};
		}
		const manifest = await readManifest( workspace );
		const versions: Versions = {};
		await readWordPressSite( sitePath, async ( site ) => {
			const posts = readPosts( site );
			const kept = new Set( posts.map( ( post ) => String( post.id ) ) );
			// A post deleted or trashed takes its copy with it.
			for ( const [ id, { type } ] of Object.entries( manifest ) ) {
				if ( ! kept.has( id ) ) {
					await rm( copyOf( workspace, { id, type } ), { force: true } );
					delete manifest[ id ];
				}
			}
			for ( const post of posts ) {
				const file = copyOf( workspace, post );
				const copy = await readCopy( file );
				const last = manifest[ post.id ];
				const untouched = copy !== undefined && last && hash( copy ) === last.file;
				if ( copy === undefined || ! last || ( untouched && last.post !== post.version ) ) {
					const content = readContent( site, post );
					await writeCopy( file, content );
					manifest[ post.id ] = { type: post.type, post: post.version, file: hash( content ) };
					versions[ post.id ] = `${ post.type } ${ post.version } ${ hash( content ) }`;
					continue;
				}
				versions[ post.id ] = `${ post.type } ${ post.version } ${ hash( copy ) }`;
			}
		} );
		await writeFile( path.join( workspace, MANIFEST ), JSON.stringify( manifest ), 'utf8' );
		return versions;
	},
	// Saves each copy changed since Studio wrote it to its post, unless the
	// post changed too.
	async check( site, _before, after, host ) {
		const workspace = workspaceOfSite( site.id );
		if ( ! existsSync( workspace ) ) {
			return { reports: [] };
		}
		const manifest = await readManifest( workspace );
		const reports: ChangeReport[] = [];
		const next: Versions = { ...after };
		for ( const [ id, version ] of Object.entries( after ) ) {
			const [ type, ...rest ] = version.split( ' ' );
			const copyHash = rest.pop();
			const postVersion = rest.join( ' ' );
			const last = manifest[ id ];
			if ( ! last || last.file === copyHash ) {
				continue;
			}
			const file = copyOf( workspace, { id, type } );
			const label = `${ site.name } ${ type } ${ id }`;
			if ( last.post !== postVersion ) {
				const unsaved = file.replace( /(\.\w+)$/, '.unsaved$1' );
				await rename( file, unsaved );
				const content = await readWordPressSite( site.path, ( wp ) =>
					readContent(
						wp,
						readPosts( wp ).find( ( post ) => String( post.id ) === id )
					)
				);
				await writeCopy( file, content );
				manifest[ id ] = { type, post: postVersion, file: hash( content ) };
				next[ id ] = `${ type } ${ postVersion } ${ hash( content ) }`;
				reports.push( {
					key: `copy ${ id }`,
					post: id,
					problem: `${ label } changed in WordPress after Studio wrote ${ file }, so Studio kept the post: ${ file } now holds it, and the copy's change is in ${ unsaved }.`,
				} );
				continue;
			}
			try {
				await ( type === GLOBAL_STYLES
					? saveGlobalStyles( host, site, id, file )
					: savePost( host, site, Number( id ), file ) );
			} catch ( error ) {
				reports.push( {
					key: `copy ${ id }`,
					post: id,
					problem: `${ label }: Studio could not save ${ file } to it: ${
						error instanceof Error ? error.message : String( error )
					}`,
				} );
				continue;
			}
			const saved = await readWordPressSite( site.path, ( wp ) =>
				readPosts( wp ).find( ( post ) => String( post.id ) === id )
			);
			manifest[ id ] = { type, post: saved?.version ?? postVersion, file: copyHash ?? '' };
			next[ id ] = `${ type } ${ manifest[ id ].post } ${ copyHash }`;
			reports.push( {
				key: `copy ${ id }`,
				post: id,
				summary: `${ label }: Studio saved ${ file } to it (${
					type === GLOBAL_STYLES ? 'PUT /wp/v2/global-styles' : 'wp_update_post()'
				})`,
			} );
		}
		await writeFile( path.join( workspace, MANIFEST ), JSON.stringify( manifest ), 'utf8' );
		return { reports, next };
	},
};
