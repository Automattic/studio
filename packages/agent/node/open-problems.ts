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
import { readFile } from 'fs/promises';
import path from 'path';
import {
	frontPageTemplateProblem,
	rendersPageContent,
} from '@studio/agent/node/front-page-template';
import { headerMenu } from '@studio/agent/node/header-menu';
import { readSavedCopies } from '@studio/agent/node/saved-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { studioMessage } from '@studio/agent/node/studio-message';
import { activeThemes, isUpdatableTheme } from '@studio/agent/node/themes';
import type { StudioAgentHost } from '@studio/agent/node/host';

interface OpenProblemsState {
	// The sites changed, whose state is checked at the end of the turn.
	sites: string[];
	// The latest problem of each file or post validated, while it has one.
	open: Record< string, string >;
	raised: string[];
}

export class OpenProblems {
	private readonly state: OpenProblemsState = { sites: [], open: {}, raised: [] };
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
			"Studio checked the sites this turn changed. Each item is how WordPress treats the site as it is now, from WordPress's source. The turn is done when each is resolved, or, for one that needs the user's choice, when the user is asked:",
			...problems.map( ( problem ) => `- ${ problem }` ),
		] ) ?? ''
	);
}

const bySession = new WeakMap< object, OpenProblems >();

/** The open problems of an agent session, kept across its turns. */
export function getOpenProblems( host: StudioAgentHost, session: object ): OpenProblems {
	let open = bySession.get( session );
	if ( ! open ) {
		open = new OpenProblems( [
			unrenderedPages,
			frontPageIsPostsPage,
			postsPageContent,
			( sitePath ) => headerMenu( host, sitePath ),
		] );
		bySession.set( session, open );
	}
	return open;
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

/**
 * The pages whose template, the one WordPress picks for each, renders no
 * page's content: the front page's front-page template, which WordPress
 * renders there whatever Settings → Reading picks (front-page-template.ts),
 * and each page's template in the page hierarchy (get_page_template in
 * wp-includes/template.php), page-{slug}, page-{id}, then page, singular and
 * index. A Site Editor copy of a template comes before the theme's file. The
 * posts page renders the posts index (postsPageContent).
 */
export async function unrenderedPages( sitePath: string ): Promise< string[] > {
	const state = await readWordPressSite( sitePath, ( site ) => {
		const saved = new Map(
			readSavedCopies( site )
				.filter( ( copy ) => copy.postType === 'wp_template' )
				.map( ( copy ) => [ copy.slug, copy.id ] )
		);
		const content = ( id: number ) =>
			site.query< { content: string } >(
				`SELECT post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
				id
			)[ 0 ]?.content ?? '';
		const pages = site.query< { id: number; slug: string; title: string } >(
			`SELECT ID AS id, post_name AS slug, post_title AS title FROM ${ site.prefix }posts WHERE post_type = 'page' AND post_status = 'publish' ORDER BY ID`
		);
		const staticFront = site.option( 'show_on_front' ) === 'page';
		return {
			saved: new Map(
				[ ...saved ].map( ( [ slug, id ] ) => [ slug, { id, content: content( id ) } ] )
			),
			pages,
			staticFront,
			front: staticFront ? Number( site.option( 'page_on_front' ) ) : 0,
			postsPage: staticFront ? Number( site.option( 'page_for_posts' ) ) : 0,
			themes: activeThemes( site ),
		};
	} );
	if ( ! state ) {
		return [];
	}
	const themeDirs = state.themes.map( ( theme ) =>
		path.join( sitePath, 'wp-content', 'themes', theme )
	);
	// The first template of the hierarchy the site has.
	const resolve = async ( slugs: string[] ) => {
		for ( const slug of slugs ) {
			const copy = state.saved.get( slug );
			if ( copy ) {
				return {
					slug,
					source: `the ${ slug } template saved in the Site Editor (post ${ copy.id })`,
					content: copy.content,
				};
			}
			for ( const theme of state.themes ) {
				const file = `wp-content/themes/${ theme }/templates/${ slug }.html`;
				const content = await readFile( path.join( sitePath, file ), 'utf8' ).catch(
					() => undefined
				);
				if ( content !== undefined ) {
					return { slug, source: file, content, theme };
				}
			}
		}
		return undefined;
	};
	const unrendered = async ( slugs: string[] ) => {
		const template = await resolve( slugs );
		return template && ( await rendersPageContent( template.content, themeDirs ) ) === false
			? template
			: undefined;
	};

	const problems: string[] = [];
	const front = state.pages.find( ( page ) => page.id === state.front );
	const frontTemplate = await unrendered( [ 'front-page' ] );
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
	const home = await resolve( [ 'home' ] );
	if ( home && ! ( home.theme && ( await isUpdatableTheme( sitePath, home.theme ) ) ) ) {
		const frontPageTemplate = await resolve( [ 'front-page' ] );
		const reason = state.staticFront
			? !! state.front &&
			  ! state.postsPage &&
			  `Settings → Reading shows page ${ state.front }${
					front ? ` "${ front.title }"` : ''
			  } at the front page (show_on_front, page_on_front) and names no posts page (page_for_posts)`
			: frontPageTemplate &&
			  `the front page shows the latest posts (show_on_front) with ${ frontPageTemplate.source }, which WordPress renders there before home.html (wp-includes/template-loader.php), and the site has no posts page`;
		if ( reason ) {
			problems.push(
				`WordPress renders ${ home.source } at the posts index (get_home_template in wp-includes/template.php), and ${ reason }, so it renders nowhere and edits to it change nothing on the site. Put what it holds where WordPress renders it, such as the front page's content in its page, or name a posts page for it in page_for_posts.`
			);
		}
	}
	const byTemplate = new Map< string, { slug: string; pages: string[] } >();
	for ( const page of state.pages ) {
		if ( page.id === state.postsPage || ( page.id === state.front && frontTemplate ) ) {
			continue;
		}
		const template = await unrendered( [
			...( page.id === state.front ? [ 'front-page' ] : [] ),
			`page-${ page.slug }`,
			`page-${ page.id }`,
			'page',
			'singular',
			'index',
		] );
		if ( template ) {
			const entry = byTemplate.get( template.source ) ?? { slug: template.slug, pages: [] };
			entry.pages.push( `page ${ page.id } "${ page.title }"` );
			byTemplate.set( template.source, entry );
		}
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
