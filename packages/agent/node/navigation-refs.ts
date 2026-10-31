/**
 * Navigation blocks whose ref renders other than a menu. A core/navigation
 * block with a "ref" renders the blocks of the post it names, by ID, in place
 * of those written inside it, as long as that post is published; it renders
 * WordPress's fallback menu when the post is not published, and no links when
 * there is no such post (get_inner_blocks() and
 * get_inner_blocks_from_navigation_post() in wp-includes/blocks/navigation.php).
 * The post is not checked to be a wp_navigation, so a ref of 0 renders the
 * post being viewed (get_post( 0 ) is the global post), and the ID of a
 * classic menu, a nav_menu term, renders the post that has that ID, if any.
 *
 * When a call changes the block markup of the active theme or of the site's
 * posts, Studio says what each navigation block's ref renders where it is
 * other than the menu it names, and keeps the problem open until the turn
 * ends with each resolved, as the menu's post can follow the block.
 */
import path from 'path';
import { readWordPressSite, type WordPressSite } from '@studio/agent/node/site-database';
import { siteMarkup, type Markup } from '@studio/agent/node/site-markup';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const NAVIGATION = /<!--\s*wp:navigation\s+(\{.*?\})\s*(\/)?-->/g;
const CLOSE = /<!--\s*\/wp:navigation\s*-->/;

/** A navigation block's ref, and what WordPress finds by it. */
interface Ref {
	place: string;
	ref: number;
	// The post that has the ref's ID, when there is one.
	post?: { type: string; status: string; title: string };
	// The classic menu that has the ref's ID, when there is one.
	menu?: string;
	// How many blocks are written inside the navigation block.
	written: number;
}

// Where a piece of markup is held, from the site's root.
const placeOf = ( root: string, item: Markup ) =>
	item.file ? path.relative( root, item.file ) : `${ item.type } ${ item.post }`;

function refsIn( site: WordPressSite, place: string, content: string ): Ref[] {
	const refs: Ref[] = [];
	for ( const match of content.matchAll( NAVIGATION ) ) {
		let ref: unknown;
		try {
			ref = ( JSON.parse( match[ 1 ] ) as { ref?: unknown } ).ref;
		} catch {
			continue;
		}
		if ( ref === undefined || ! /^\d+$/.test( String( ref ) ) ) {
			continue;
		}
		const id = Number( ref );
		const rest = content.slice( match.index + match[ 0 ].length );
		const inside = match[ 2 ] ? '' : rest.slice( 0, Math.max( rest.search( CLOSE ), 0 ) );
		const [ post ] = id
			? site.query< { type: string; status: string; title: string } >(
					`SELECT post_type AS type, post_status AS status, post_title AS title FROM ${ site.prefix }posts WHERE ID = ?`,
					id
			  )
			: [];
		const [ menu ] = id
			? site.query< { name: string } >(
					`SELECT t.name FROM ${ site.prefix }terms t JOIN ${ site.prefix }term_taxonomy tt ON tt.term_id = t.term_id WHERE tt.taxonomy = 'nav_menu' AND t.term_id = ?`,
					id
			  )
			: [];
		refs.push( {
			place,
			ref: id,
			post,
			menu: menu?.name,
			written: [ ...inside.matchAll( /<!--\s*wp:/g ) ].length,
		} );
	}
	return refs;
}

// A ref to a published wp_navigation renders the menu it names.
const isMenu = ( ref: Ref ) => ref.post?.type === 'wp_navigation' && ref.post.status === 'publish';

function describe( ref: Ref ): string {
	const block = `The core/navigation block in ${ ref.place } has "ref":${ ref.ref }`;
	const menu = ref.menu
		? ` ${ ref.ref } is the ID of the classic menu "${ ref.menu }", a nav_menu term, not a post.`
		: '';
	const { post } = ref;
	if ( ! ref.ref ) {
		return `${ block }, and get_post( 0 ) is the post being viewed, so on a page or post it renders that post's content as the menu, and elsewhere no links.`;
	}
	if ( ! post ) {
		return `${ block }, and the site has no post ${ ref.ref }, so it renders no links.${ menu }`;
	}
	if ( post.status !== 'publish' ) {
		return `${ block }, and post ${ ref.ref } is a ${ post.type } with the status ${ post.status }, so it renders WordPress's fallback menu: the most recently published wp_navigation, else one WordPress creates from a classic menu or a list of the site's pages (block_core_navigation_get_fallback_blocks() in wp-includes/blocks/navigation.php).${ menu }`;
	}
	if ( post.type !== 'wp_navigation' ) {
		return `${ block }, and post ${ ref.ref } is the ${ post.type } "${ post.title }", so it renders that ${ post.type }'s content as the menu.${ menu }`;
	}
	return `${ block }, so it renders the links of wp_navigation ${ ref.ref } "${ post.title }", not the ${ ref.written } block(s) written inside it.`;
}

const RULE =
	'A navigation block with a ref renders the blocks of the published post that has that ID in place of those written inside it, and one with no ref renders those written inside it (get_inner_blocks() in wp-includes/blocks/navigation.php).';

const key = ( ref: Ref ) => JSON.stringify( ref );

export const navigationRefs: SiteChangeSource = {
	name: 'navigation refs',
	async read( sitePath ) {
		return readWordPressSite( sitePath, async ( site ) => {
			const themes = [
				...new Set( [ site.option( 'template' ), site.option( 'stylesheet' ) ] ),
			].filter( ( theme ): theme is string => typeof theme === 'string' && theme !== '' );
			const markup = [
				...( await Promise.all(
					themes.map( ( theme ) =>
						siteMarkup( sitePath, path.join( sitePath, 'wp-content', 'themes', theme ), {
							posts: false,
						} )
					)
				) ),
				await siteMarkup( sitePath, undefined, { holding: '%wp:navigation {%' } ),
			].flat();
			const refs = markup
				.filter( ( item ) => item.content.includes( 'wp:navigation ' ) )
				.flatMap( ( item ) => refsIn( site, placeOf( sitePath, item ), item.content ) )
				// A ref to a menu with nothing written inside it renders as written.
				.filter( ( ref ) => ! isMenu( ref ) || ref.written );
			const versions: Versions = {};
			for ( const ref of refs ) {
				versions[ ref.place ] = JSON.stringify( [
					...JSON.parse( versions[ ref.place ] ?? '[]' ),
					ref,
				] );
			}
			return versions;
		} );
	},
	async check( site, before, after ) {
		const reports = [];
		for ( const place of new Set( [ ...Object.keys( before ), ...Object.keys( after ) ] ) ) {
			if ( before[ place ] === after[ place ] ) {
				continue;
			}
			const refs: Ref[] = JSON.parse( after[ place ] ?? '[]' );
			const was = new Set( ( JSON.parse( before[ place ] ?? '[]' ) as Ref[] ).map( key ) );
			const added = refs.filter( ( ref ) => ! was.has( key( ref ) ) );
			const broken = refs.filter( ( ref ) => ! isMenu( ref ) );
			reports.push( {
				key: `navigation refs in ${ place } of ${ site.path }`,
				summary: added.length ? [ ...added.map( describe ), RULE ].join( ' ' ) : undefined,
				problem: broken.length ? [ ...broken.map( describe ), RULE ].join( ' ' ) : undefined,
				atTurnEnd: true,
			} );
		}
		return { reports };
	},
};
