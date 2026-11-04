/**
 * What is still wrong on the sites an agent changed, checked when it ends its
 * turn: the block validation problems its calls were told about and has not
 * fixed since, and site state that only shows once every call is done, such as
 * a front page whose content WordPress never renders, or header links to home
 * page sections that only work on the home page.
 *
 * Each problem is raised once, so the agent decides what to do with it: fix
 * it, or ask the user about one that needs their choice. A site's state is
 * checked against the site as Studio first saw it in the session, so what
 * the user's site already had is not raised as the turn's: in run 27 a site
 * whose page template rendered no page content had its saved Site Editor
 * styles lost to a child theme the agent made to fix that, after it had
 * changed the background it was asked for.
 */
import { copiedPageChrome } from '@studio/agent/node/copied-page-chrome';
import { frontPageTemplateProblem } from '@studio/agent/node/front-page-template';
import { headerMenu } from '@studio/agent/node/header-menu';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { missingSourceText } from '@studio/agent/node/source-text';
import { studioMessage } from '@studio/agent/node/studio-message';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { StudioAgentHost } from '@studio/agent/node/host';

interface OpenProblemsState {
	// The sites changed, whose state is checked at the end of the turn.
	sites: string[];
	// The latest problem of each file or post validated, while it has one.
	open: Record< string, string >;
	raised: string[];
	// The problems open at the agent's last look at a site, and those it was told again.
	looked: string[];
	repeated: string[];
}

export class OpenProblems {
	private readonly state: OpenProblemsState = {
		sites: [],
		open: {},
		raised: [],
		looked: [],
		repeated: [],
	};
	// Each site's problems as Studio first saw it, before the session changed
	// it: the user's site as it was, not the session's to raise.
	private readonly before = new Map< string, Promise< string[] > >();

	constructor(
		private readonly siteChecks: Array<
			( sitePath: string ) => Promise< string | string[] | undefined >
		>
	) {}

	/** Records the latest validation of a site's file or post, open while it has a problem. */
	record( site: string, key: string, problem?: string ): void {
		if ( ! this.state.sites.includes( site ) ) {
			this.state.sites.push( site );
		}
		if ( problem ) {
			this.state.open[ key ] = problem;
		} else {
			delete this.state.open[ key ];
		}
	}

	/**
	 * At the agent's look at the sites, as a screenshot is: the problems open
	 * at its last look too, which it has heard on a result since and not fixed,
	 * each said again once. In eval17 an agent left an invalid core/cover it
	 * was told about on the call that made it, and the theme.json keys
	 * WordPress drops it was told about 38 calls before the end of its turn.
	 */
	look(): string[] {
		const open = Object.values( this.state.open );
		const again = open.filter(
			( problem ) =>
				this.state.looked.includes( problem ) && ! this.state.repeated.includes( problem )
		);
		this.state.looked = open;
		this.state.repeated.push( ...again );
		return again;
	}

	/** Notes a site's problems as they are, before a call that can change it. */
	async see( site: string ): Promise< void > {
		if ( ! this.before.has( site ) ) {
			this.before.set( site, this.siteProblems( site ) );
		}
		await this.before.get( site );
	}

	private async siteProblems( site: string ): Promise< string[] > {
		const problems = await Promise.all(
			this.siteChecks.map( ( check ) => check( site ).catch( () => undefined ) )
		);
		return problems.flat().filter( ( problem ): problem is string => !! problem );
	}

	/** The open problems not raised before, which are raised now. */
	async raise(): Promise< string[] > {
		const siteProblems = await Promise.all(
			this.state.sites.map( async ( site ) => {
				const before = ( await this.before.get( site ) ) ?? [];
				return ( await this.siteProblems( site ) ).filter(
					( problem ) => ! before.includes( problem )
				);
			} )
		);
		const problems = [ ...Object.values( this.state.open ), ...siteProblems.flat() ].filter(
			( problem ) => ! this.state.raised.includes( problem )
		);
		this.state.raised.push( ...problems );
		return problems;
	}
}

/**
 * The message that continues a turn with open problems. It reaches the model
 * in the user's role, so it is tagged as Studio's, the way Pi tags the
 * summaries it adds; the user does not see it.
 */
export function describeOpenProblems( problems: string[] ): string {
	return (
		studioMessage( 'checks', [
			"Studio checked the sites this turn changed. Each item is how WordPress treats the site as it is now. The turn is done when each is resolved, or, for one that needs the user's choice, when the user is asked:",
			...problems.map( ( problem ) => `- ${ problem }` ),
		] ) ?? ''
	);
}

/** The problems the agent is told again as it looks at the sites (OpenProblems.look()). */
export function describeStillOpen( problems: string[] ): string | undefined {
	return problems.length
		? [
				'Studio reported these on earlier calls, and they are still open on the site:',
				...problems.map( ( problem ) => `- ${ problem }` ),
		  ].join( '\n' )
		: undefined;
}

/** The open problems of a session, checked with each of Studio's checks of a site. */
export function createOpenProblems( host: StudioAgentHost ): OpenProblems {
	return new OpenProblems( [
		( sitePath ) => unrenderedPages( host, sitePath ),
		frontPageIsPostsPage,
		postsPageContent,
		( sitePath ) => headerMenu( host, sitePath ),
		copiedPageChrome,
		( sitePath ) => missingSourceText( host, sitePath ),
	] );
}

/**
 * Settings → Reading naming one page as both the front page and the posts
 * page, which its screen warns against (wp-admin/options-reading.php).
 */
export async function frontPageIsPostsPage( sitePath: string ): Promise< string | undefined > {
	const page = await readWordPressSite( sitePath, ( site ) => {
		const front = site.option( 'page_on_front' );
		const same =
			site.option( 'show_on_front' ) === 'page' &&
			Number( front ) > 0 &&
			site.option( 'page_for_posts' ) === front;
		if ( ! same ) {
			return undefined;
		}
		const [ post ] = site.query< { title: string } >(
			`SELECT post_title AS title FROM ${ site.prefix }posts WHERE ID = ?`,
			Number( front )
		);
		return { id: front, title: post?.title ?? '' };
	} );
	return page
		? `Settings → Reading names page ${ page.id } "${ page.title }" as both the front page (page_on_front) and the posts page (page_for_posts), which its screen warns against ("these pages should not be the same!", wp-admin/options-reading.php): WordPress then queries the posts index at the front page instead of that page (WP_Query::parse_query in wp-includes/class-wp-query.php). Set page_for_posts to another page, or to 0 for none.`
		: undefined;
}

/**
 * Settings → Reading naming a page with content as the posts page, where
 * WordPress shows the posts index instead (WP_Query::parse_query). The same
 * page as the front page is frontPageIsPostsPage's.
 */
export async function postsPageContent( sitePath: string ): Promise< string | undefined > {
	const page = await readWordPressSite( sitePath, ( site ) => {
		const postsPage = Number( site.option( 'page_for_posts' ) );
		if (
			site.option( 'show_on_front' ) !== 'page' ||
			postsPage === Number( site.option( 'page_on_front' ) )
		) {
			return undefined;
		}
		const [ post ] = site.query< { title: string; content: string } >(
			`SELECT post_title AS title, post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
			postsPage
		);
		return post?.content.trim() ? { id: postsPage, title: post.title } : undefined;
	} );
	return page
		? `Settings → Reading names page ${ page.id } "${ page.title }", which has content, as the posts page (page_for_posts): WordPress queries the posts index at that page, so its content shows nowhere (WP_Query::parse_query in wp-includes/class-wp-query.php), and the editor shows "You are currently editing the page that shows your latest posts." (wp-admin/edit-form-advanced.php). Set page_for_posts to an empty page for the posts index, or to 0 for none.`
		: undefined;
}

// The template WordPress renders a request with, as template-loader.php picks
// it (the tag loop of front-page-render.ts), whether a core/post-content
// block renders in it, through its parts and patterns, and the post the
// request queries as its one post, if it does: a plugin can query a page's
// request as something else, as WooCommerce queries its shop page as the
// products archive (WC_Query::pre_get_posts), where is_singular() is false
// and post-content would render the archive's posts, not the page.
const TEMPLATES = `
$tags = array( 'is_embed' => 'get_embed_template', 'is_404' => 'get_404_template', 'is_search' => 'get_search_template', 'is_front_page' => 'get_front_page_template', 'is_home' => 'get_home_template', 'is_privacy_policy' => 'get_privacy_policy_template', 'is_post_type_archive' => 'get_post_type_archive_template', 'is_tax' => 'get_taxonomy_template', 'is_attachment' => 'get_attachment_template', 'is_single' => 'get_single_template', 'is_page' => 'get_page_template', 'is_singular' => 'get_singular_template', 'is_category' => 'get_category_template', 'is_tag' => 'get_tag_template', 'is_author' => 'get_author_template', 'is_date' => 'get_date_template', 'is_archive' => 'get_archive_template' );
$describe = function ( $template ) {
	$file = 'theme' === $template->source ? _get_block_template_file( 'wp_template', $template->slug ) : null;
	if ( $file ) {
		$source = 'wp-content/' . ltrim( substr( wp_normalize_path( $file['path'] ), strlen( wp_normalize_path( realpath( WP_CONTENT_DIR ) ) ) ), '/' );
	} elseif ( 'custom' === $template->source ) {
		$source = "the {$template->slug} template saved in the Site Editor (post {$template->wp_id})";
	} else {
		$source = "the {$template->slug} template" . ( empty( $template->plugin ) ? '' : " the {$template->plugin} plugin registers" );
	}
	return array( 'slug' => $template->slug, 'source' => $source, 'theme' => $file ? $file['theme'] : null );
};
$render = function ( $vars ) use ( $tags, $describe ) {
	$GLOBALS['_wp_current_template_id']      = null;
	$GLOBALS['_wp_current_template_content'] = '';
	$_SERVER['REQUEST_URI']                  = '/';
	wp( $vars );
	$found = false;
	foreach ( $tags as $tag => $getter ) {
		if ( $tag() && ( $found = $getter() ) ) {
			break;
		}
	}
	if ( ! $found ) {
		get_index_template();
	}
	$template = empty( $GLOBALS['_wp_current_template_id'] ) ? null : get_block_template( $GLOBALS['_wp_current_template_id'] );
	if ( ! $template ) {
		return null;
	}
	$shown = 0;
	$count = function ( $parsed ) use ( &$shown ) {
		if ( 'core/post-content' === $parsed['blockName'] ) {
			++$shown;
		}
		return $parsed;
	};
	add_filter( 'render_block_data', $count );
	get_the_block_template_html();
	remove_filter( 'render_block_data', $count );
	return $describe( $template ) + array( 'content' => $shown > 0, 'post' => is_singular() ? get_queried_object_id() : 0 );
};
$static = 'page' === get_option( 'show_on_front' );
$front  = $static ? (int) get_option( 'page_on_front' ) : 0;
$posts  = $static ? (int) get_option( 'page_for_posts' ) : 0;
$at_front = $render( $front ? array( 'page_id' => $front ) : array() );
$pages    = array();
foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'ID', 'order' => 'ASC' ) ) as $page ) {
	$pages[] = array(
		'id'       => $page->ID,
		'title'    => $page->post_title,
		'template' => $page->ID === $front ? $at_front : ( $page->ID === $posts ? null : $render( array( 'page_id' => $page->ID ) ) ),
	);
}
$home = get_block_template( get_stylesheet() . '//home' );
echo wp_json_encode( array(
	'static' => $static,
	'front'  => $front,
	'posts'  => $posts,
	'atFront' => $at_front,
	'pages'  => $pages,
	'home'   => $home ? $describe( $home ) : null,
	'index'  => $static && $front ? ( $posts ? $render( array( 'page_id' => $posts ) ) : null ) : $at_front,
) );`;

interface RenderedTemplate {
	slug: string;
	// The theme file, or the Site Editor's or a plugin's template, it comes from.
	source: string;
	// The theme whose file it is.
	theme: string | null;
	content?: boolean;
	// The post the request queries as its one post (is_singular), or 0.
	post?: number;
}

/**
 * The pages whose template, the one WordPress renders each with, renders no
 * page's content: the front page's front-page template, which WordPress
 * renders there whatever Settings → Reading picks (front-page-template.ts),
 * and each page's template in the page hierarchy (get_page_template in
 * wp-includes/template.php). The posts page renders the posts index
 * (postsPageContent), and home.html only there.
 */
export async function unrenderedPages(
	host: StudioAgentHost,
	sitePath: string
): Promise< string[] > {
	const site = await host.sites.findByFolder( sitePath );
	if ( ! site ) {
		return [];
	}
	const state = await wpEvalJson< {
		static: boolean;
		front: number;
		posts: number;
		atFront: RenderedTemplate | null;
		pages: Array< { id: number; title: string; template: RenderedTemplate | null } >;
		home: RenderedTemplate | null;
		index: RenderedTemplate | null;
	} >( host, site, TEMPLATES );

	const problems: string[] = [];
	const front = state.pages.find( ( page ) => page.id === state.front );
	// A page shows through post-content only where the request queries that
	// page as its one post, not where a plugin queries it as an archive.
	const queries = ( template: RenderedTemplate, page: number ) => template.post === page;
	const frontTemplate =
		state.atFront?.slug === 'front-page' &&
		! state.atFront.content &&
		( ! state.front || queries( state.atFront, state.front ) )
			? state.atFront
			: undefined;
	if ( frontTemplate ) {
		problems.push(
			frontPageTemplateProblem(
				frontTemplate.source,
				front && `page ${ front.id } "${ front.title }"`
			)
		);
	}
	// The posts index renders with home.html (get_home_template), where the
	// front page's front-page template does not come first
	// (wp-includes/template-loader.php).
	const { home, index } = state;
	if ( home && ! ( home.theme && ( await isUpdatableTheme( sitePath, home.theme ) ) ) ) {
		const reason = state.static
			? !! state.front &&
			  ! state.posts &&
			  `Settings → Reading shows page ${ state.front }${
					front ? ` "${ front.title }"` : ''
			  } at the front page (show_on_front, page_on_front) and names no posts page (page_for_posts)`
			: index?.slug === 'front-page' &&
			  `the front page shows the latest posts (show_on_front) with ${ index.source }, which WordPress renders there before home.html (wp-includes/template-loader.php), and the site has no posts page`;
		if ( reason ) {
			problems.push(
				`WordPress renders ${ home.source } at the posts index (get_home_template in wp-includes/template.php), and ${ reason }, so it renders nowhere and edits to it change nothing on the site. Put what it holds where WordPress renders it, such as the front page's content in its page, or name a posts page for it in page_for_posts.`
			);
		}
	}
	const byTemplate = new Map< string, { slug: string; pages: string[] } >();
	for ( const page of state.pages ) {
		const { template } = page;
		if (
			! template ||
			template.content ||
			! queries( template, page.id ) ||
			( page.id === state.front && frontTemplate )
		) {
			continue;
		}
		const entry = byTemplate.get( template.source ) ?? { slug: template.slug, pages: [] };
		entry.pages.push( `page ${ page.id } "${ page.title }"` );
		byTemplate.set( template.source, entry );
	}
	for ( const [ source, { slug, pages } ] of byTemplate ) {
		const one = pages.length === 1;
		problems.push(
			`WordPress renders ${ pages.join(
				', '
			) } with ${ source } (the page template hierarchy, get_page_template in wp-includes/template.php), which has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), so ${
				one ? 'its' : 'their'
			} content never shows, and edits to ${
				one ? 'it' : 'them'
			} change nothing on the site. Put the content in ${
				one ? 'the page' : 'each page'
			}, and render it with <!-- wp:post-content /--> in the template${
				slug.startsWith( 'page-' ) ? ', or remove the template so page.html renders the page' : ''
			}.`
		);
	}
	return problems;
}
