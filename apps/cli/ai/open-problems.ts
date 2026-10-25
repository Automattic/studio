/**
 * What is still wrong on the sites an agent changed, checked when it ends its
 * turn: the block validation problems its calls were told about and has not
 * fixed since, and site state that only shows once every call is done, such as
 * a front page whose content WordPress never renders, or header links to home
 * page sections that only work on the home page.
 *
 * Each problem is raised once, so the agent decides what to do with it: fix
 * it, or tell the user why it stays.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import {
	FRONT_PAGE_TEMPLATE,
	frontPageTemplateProblem,
	rendersPageContent,
} from 'cli/ai/front-page-template';
import { headerMenu } from 'cli/ai/header-menu';
import { homeSectionLinks } from 'cli/ai/home-section-links';
import { readSavedCopies } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { studioMessage } from 'cli/ai/studio-message';
import { activeThemes } from 'cli/ai/themes';

interface OpenProblemsState {
	// The sites changed, whose state is checked at the end of the turn.
	sites: string[];
	// The latest problem of each file or post validated, while it has one.
	open: Record< string, string >;
	raised: string[];
}

export class OpenProblems {
	private readonly state: OpenProblemsState = { sites: [], open: {}, raised: [] };

	constructor(
		private readonly siteChecks: Array< ( sitePath: string ) => Promise< string | undefined > > = [
			unrenderedFrontPage,
			frontPageIsPostsPage,
			postsPageContent,
			homeSectionLinks,
			headerMenu,
		]
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

	/** The open problems not raised before, which are raised now. */
	async raise(): Promise< string[] > {
		const siteProblems = await Promise.all(
			this.state.sites.flatMap( ( site ) =>
				this.siteChecks.map( ( check ) => check( site ).catch( () => undefined ) )
			)
		);
		const problems = [ ...Object.values( this.state.open ), ...siteProblems ].filter(
			( problem ): problem is string => !! problem && ! this.state.raised.includes( problem )
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
			'Studio checked the sites this turn changed:',
			...problems.map( ( problem ) => `- ${ problem }` ),
		] ) ?? ''
	);
}

const bySession = new WeakMap< object, OpenProblems >();

/** The open problems of an agent session, kept across its turns. */
export function getOpenProblems( session: object ): OpenProblems {
	let open = bySession.get( session );
	if ( ! open ) {
		open = new OpenProblems();
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
 * A front-page template of the active theme that renders no page's content,
 * which WordPress shows at the front page whatever Settings → Reading picks
 * (front-page-template.ts).
 */
export async function unrenderedFrontPage( sitePath: string ): Promise< string | undefined > {
	const state = await readWordPressSite( sitePath, ( site ) => {
		const saved = readSavedCopies( site ).find(
			( copy ) => copy.postType === 'wp_template' && copy.slug === 'front-page'
		);
		const post = ( id: number ) =>
			site.query< { title: string; content: string } >(
				`SELECT post_title AS title, post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
				id
			)[ 0 ];
		const pageId =
			site.option( 'show_on_front' ) === 'page' ? Number( site.option( 'page_on_front' ) ) : 0;
		return {
			frontPage: pageId ? `page ${ pageId } "${ post( pageId )?.title ?? '' }"` : undefined,
			saved: saved && { id: saved.id, content: post( saved.id )?.content ?? '' },
			themes: activeThemes( site ),
		};
	} );
	if ( ! state ) {
		return undefined;
	}
	const themeDirs = state.themes.map( ( theme ) =>
		path.join( sitePath, 'wp-content', 'themes', theme )
	);
	let template = state.saved?.content;
	let source = `the front-page template saved in the Site Editor (post ${ state.saved?.id })`;
	for ( const theme of state.saved ? [] : state.themes ) {
		const file = `wp-content/themes/${ theme }/${ FRONT_PAGE_TEMPLATE }`;
		template = await readFile( path.join( sitePath, file ), 'utf8' ).catch( () => undefined );
		source = file;
		if ( template !== undefined ) {
			break;
		}
	}
	if ( template === undefined || ( await rendersPageContent( template, themeDirs ) ) !== false ) {
		return undefined;
	}
	return frontPageTemplateProblem( source, state.frontPage );
}
