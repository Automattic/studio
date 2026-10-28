/**
 * A theme's front-page template, which WordPress renders at the site's front
 * page whatever Settings → Reading picks (wp-includes/template.php,
 * get_front_page_template). It shows the page Reading picks only through a
 * post-content block, so a theme must render one there: the Theme Directory
 * requires a theme to show the content the front page setting picks.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { WordPressSite } from '@studio/agent/node/site-database';

const REQUIREMENT = 'https://make.wordpress.org/themes/handbook/review/required/';
const POST_CONTENT = /<!--\s*wp:post-content\b/;
const PATTERN = /<!--\s*wp:pattern\s+(\{.*?\})\s*\/?-->/g;

/** The front-page template's path, relative to its theme. */
export const FRONT_PAGE_TEMPLATE = 'templates/front-page.html';

// The theme's patterns, by slug, from the Slug header of patterns/*.php.
async function themePatterns( themeDir: string ): Promise< Map< string, string > > {
	const dir = path.join( themeDir, 'patterns' );
	const files = await readdir( dir ).catch( () => [] as string[] );
	const patterns = new Map< string, string >();
	for ( const file of files.filter( ( name ) => name.endsWith( '.php' ) ) ) {
		const content = await readFile( path.join( dir, file ), 'utf8' ).catch( () => '' );
		const slug = content.match( /^[\s*]*Slug:\s*(\S+)/im )?.[ 1 ];
		if ( slug ) {
			patterns.set( slug, content );
		}
	}
	return patterns;
}

/**
 * Whether a front-page template renders a page's content, with the theme's
 * patterns it includes; undefined when it includes a pattern the theme does
 * not hold, which may render it.
 */
export async function rendersPageContent(
	template: string,
	themeDirs: string[]
): Promise< boolean | undefined > {
	const slugs = [ ...template.matchAll( PATTERN ) ].map( ( match ) => {
		try {
			return String( JSON.parse( match[ 1 ] ).slug ?? '' );
		} catch {
			return '';
		}
	} );
	if ( POST_CONTENT.test( template ) ) {
		return true;
	}
	const patterns = new Map< string, string >();
	for ( const dir of [ ...themeDirs ].reverse() ) {
		for ( const [ slug, content ] of await themePatterns( dir ) ) {
			patterns.set( slug, content );
		}
	}
	const included = slugs.map( ( slug ) => patterns.get( slug ) );
	if ( included.some( ( content ) => content === undefined ) ) {
		return undefined;
	}
	return included.some( ( content ) => POST_CONTENT.test( content! ) );
}

/** What a front-page template without a page's content makes WordPress do. */
export function frontPageTemplateProblem( source: string, frontPage?: string ): string {
	const shows = frontPage
		? `so ${ frontPage }, the front page Settings → Reading picks, never shows, and edits to it change nothing on the site`
		: "so no page set as the homepage (Settings → Reading, or the editor's Set as homepage) can show, and the content lives in the theme instead of a page the site owner edits";
	return `WordPress renders ${ source } at the front page whatever Settings → Reading picks (wp-includes/template.php, get_front_page_template), and it has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), ${ shows }. The Theme Directory requires a theme to show the content the front page setting picks (${ REQUIREMENT }). Put the content in a page, set it as the homepage (show_on_front=page, page_on_front), and render it with <!-- wp:post-content /--> in the template, or remove the template so page.html renders the page.`;
}

/**
 * What Settings → Reading shows at the homepage and the posts page, as a site
 * fact. WP_Query::parse_query() shows page_on_front whenever show_on_front is
 * `page` and it names one, so a page that is gone or unpublished is stated
 * as such.
 */
export function homepageFact( site: WordPressSite ): string | undefined {
	const page = ( option: string ) => {
		const id = Number( site.option( option ) );
		if ( ! id ) {
			return undefined;
		}
		const row = site.query< { title: string; status: string } >(
			`SELECT post_title AS title, post_status AS status FROM ${ site.prefix }posts WHERE ID = ? AND post_type = 'page'`,
			id
		)[ 0 ];
		if ( ! row ) {
			return `page ${ id }, which does not exist`;
		}
		return `page ${ id } "${ row.title }"${ row.status === 'publish' ? '' : ` (${ row.status })` }`;
	};
	const showOnFront = site.option( 'show_on_front' );
	const front = showOnFront === 'page' ? page( 'page_on_front' ) : undefined;
	if ( ! front ) {
		return showOnFront === undefined ? undefined : 'Homepage: the latest posts (show_on_front).';
	}
	const posts = page( 'page_for_posts' );
	return `Homepage: ${ front } (show_on_front, page_on_front)${
		posts ? `; posts page: ${ posts } (page_for_posts)` : ''
	}.`;
}
