/**
 * Posts and pages WordPress gave another slug than the one asked for. When
 * another post already has a slug, wp_unique_post_slug() in
 * wp-includes/post.php gives the new one the slug with the next free number:
 * among the posts of its type, and for a page among its siblings and the
 * attachments with the same parent, as an uploaded image named "about" is.
 * A page created twice, or after an image of its name, is then served at
 * another address than the links to it name.
 */
import { readWordPressSite } from '@studio/agent/node/site-database';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

interface Slugged {
	type: string;
	parent: number;
	slug: string;
	title: string;
}

// The types whose slugs are their addresses, and the attachments a page's slug is checked against.
const TYPES = [ 'post', 'page', 'attachment' ];
const NUMBERED = /^(.+)-([2-9]|[1-9]\d+)$/;

const parse = ( version: string ): Slugged => JSON.parse( version );
const label = ( id: string, post: Slugged ) =>
	`${ post.type } ${ id }${ post.title ? ` "${ post.title }"` : '' }`;

/** The post each numbered slug's own slug belongs to, as wp_unique_post_slug() compares them, by post. */
function takenBy( versions: Versions ): Map< string, string > {
	const taken = new Map< string, string >();
	const posts = Object.entries( versions ).map(
		( [ id, version ] ) => [ id, parse( version ) ] as const
	);
	for ( const [ id, post ] of posts ) {
		const base = NUMBERED.exec( post.slug )?.[ 1 ];
		if ( ! base || post.type === 'attachment' ) {
			continue;
		}
		const owner = posts.find(
			( [ other, it ] ) =>
				other !== id &&
				it.slug === base &&
				it.parent === post.parent &&
				( it.type === post.type || ( post.type === 'page' && it.type === 'attachment' ) )
		);
		if ( owner ) {
			taken.set( id, owner[ 0 ] );
		}
	}
	return taken;
}

export const renamedSlugs: SiteChangeSource = {
	name: 'renamed slugs',
	read: ( sitePath ) =>
		readWordPressSite( sitePath, ( site ) =>
			Object.fromEntries(
				site
					.query< { id: number } & Slugged >(
						`SELECT ID AS id, post_type AS type, post_parent AS parent, post_name AS slug, post_title AS title
						FROM ${ site.prefix }posts
						WHERE post_type IN (${ TYPES.map( () => '?' ).join( ', ' ) })
						AND post_status NOT IN ('auto-draft', 'trash') AND post_name != ''`,
						...TYPES
					)
					.map( ( { id, type, parent, slug, title } ) => [
						String( id ),
						JSON.stringify( { type, parent: Number( parent ), slug, title } ),
					] )
			)
		),
	async check( site, before, after ) {
		const was = takenBy( before );
		const now = takenBy( after );
		const reports: ChangeReport[] = [];
		for ( const [ id, owner ] of now ) {
			const post = parse( after[ id ] );
			if ( before[ id ] && parse( before[ id ] ).slug === post.slug ) {
				continue;
			}
			const base = NUMBERED.exec( post.slug )![ 1 ];
			reports.push( {
				key: `slug ${ id }`,
				post: id,
				problem: `${ site.name } ${ label( id, post ) } has the slug ${
					post.slug
				}, not ${ base }: WordPress gives a post the slug with the next free number when another post has it (wp_unique_post_slug() in wp-includes/post.php), and ${ label(
					owner,
					parse( after[ owner ] )
				) } has ${ base }. Delete the one not wanted, or give each its own slug.`,
			} );
		}
		// Resolved once its slug is its own, or the post that had it is gone.
		for ( const id of was.keys() ) {
			if ( ! now.has( id ) ) {
				reports.push( { key: `slug ${ id }`, post: id } );
			}
		}
		return { reports };
	},
};
