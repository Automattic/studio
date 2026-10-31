/**
 * A header or footer copied into each page's content. A copy in a page is
 * that page's own: an edit to one changes none of the others, and the Site
 * Editor does not edit it as the site's header or footer. A template part
 * renders the same blocks on every page whose template includes it
 * (wp-includes/blocks/template-part.php), as Twenty Twenty-Five's templates
 * include its header and footer parts.
 */
import { readWordPressSite } from '@studio/agent/node/site-database';

const DELIMITER = /<!--\s+(\/)?wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\b[\s\S]*?(\/)?-->/g;

interface Block {
	name: string;
	markup: string;
}

// A post's top-level blocks, by their delimiters, with what each holds.
function topLevelBlocks( content: string ): Block[] {
	const blocks: Block[] = [];
	let depth = 0;
	let start = 0;
	let name = '';
	for ( const match of content.matchAll( DELIMITER ) ) {
		const [ delimiter, closer, blockName, selfClosing ] = match;
		const at = match.index ?? 0;
		if ( closer ) {
			depth--;
			if ( ! depth ) {
				blocks.push( { name, markup: content.slice( start, at + delimiter.length ) } );
			}
		} else if ( selfClosing ) {
			if ( ! depth ) {
				blocks.push( { name: blockName, markup: delimiter } );
			}
		} else {
			if ( ! depth ) {
				start = at;
				name = blockName;
			}
			depth++;
		}
	}
	return blocks;
}

const label = ( name: string ) => ( name.includes( '/' ) ? name : `core/${ name }` );

/** The headers and footers a site's published pages each hold a copy of. */
export async function copiedPageChrome( sitePath: string ): Promise< string[] > {
	const pages =
		( await readWordPressSite( sitePath, ( site ) =>
			site.query< { id: number; title: string; content: string } >(
				`SELECT ID AS id, post_title AS title, post_content AS content FROM ${ site.prefix }posts WHERE post_type = 'page' AND post_status = 'publish' ORDER BY ID`
			)
		) ) ?? [];
	const blocks = pages.map( ( page ) => ( { page, blocks: topLevelBlocks( page.content ) } ) );
	return ( [ 'header', 'footer' ] as const ).flatMap( ( part ) => {
		const copies = new Map< string, { name: string; pages: string[] } >();
		for ( const { page, blocks: own } of blocks ) {
			const block = part === 'header' ? own[ 0 ] : own[ own.length - 1 ];
			// A block with blocks inside it; a synced pattern or template part
			// (self-closing) already renders from one place.
			if ( ! block || ! /<!--\s+wp:/.test( block.markup.slice( 1 ) ) ) {
				continue;
			}
			const copy = copies.get( block.markup ) ?? { name: block.name, pages: [] };
			copy.pages.push( `${ page.id } "${ page.title }"` );
			copies.set( block.markup, copy );
		}
		return [ ...copies.values() ]
			.filter( ( copy ) => copy.pages.length > 1 )
			.map(
				( { name, pages: copied } ) =>
					`Pages ${ copied.join( ', ' ) } each ${
						part === 'header' ? 'begin' : 'end'
					} with the same ${ label(
						name
					) }, a copy in each page's content: an edit to one changes none of the others, and the Site Editor does not edit it as the site's ${ part }. A template part renders the same blocks on every page whose template includes it (wp-includes/blocks/template-part.php), as Twenty Twenty-Five's templates include parts/${ part }.html. Put it in the theme's parts/${ part }.html, include it in the templates with <!-- wp:template-part {"slug":"${ part }"} /-->, and take it out of the pages.`
			);
	} );
}
