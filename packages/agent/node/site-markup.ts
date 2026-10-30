/**
 * The block markup a site renders, where it is held: its theme's templates,
 * template parts and patterns, and the content in the database WordPress
 * renders (posts, pages, templates, template parts, patterns and navigation
 * menus), and the saves that change it as an administrator's save in the
 * editor does.
 */
import { readFileSync } from 'fs';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { AS_ADMINISTRATOR, runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';

/** Same-second edits can have equal lengths; the content hash distinguishes them. */
export const POST_VERSION = "post_modified_gmt || ' ' || studio_content_hash(post_content)";

export const RENDERED_TYPES = [
	'post',
	'page',
	'wp_template',
	'wp_template_part',
	'wp_block',
	'wp_navigation',
];

export const RENDERED = `post_type IN (${ RENDERED_TYPES.map( () => '?' ).join(
	', '
) }) AND post_status NOT IN ('auto-draft', 'inherit', 'trash')`;

/** A file or post of block markup, as it reads now. */
export interface Markup {
	file?: string;
	post?: number;
	// A post's type, as wp_template_part.
	type?: string;
	content: string;
}

/** A theme's template, template part and pattern files. */
export async function themeMarkupFiles( themeDir: string ): Promise< string[] > {
	const entries = await readdir( themeDir, { recursive: true, withFileTypes: true } ).catch(
		() => []
	);
	return entries
		.filter(
			( entry ) =>
				entry.isFile() &&
				/\.(html|php)$/.test( entry.name ) &&
				/^(templates|parts|patterns)$/.test( path.basename( entry.parentPath ) )
		)
		.map( ( entry ) => path.join( entry.parentPath, entry.name ) );
}

/**
 * The block markup of a theme's files, and of the rendered posts whose
 * content holds `holding` (as SQL LIKE matches it) when `posts` is set.
 */
export async function siteMarkup(
	siteRoot: string,
	themeDir: string | undefined,
	{ posts = true, holding = '%' }: { posts?: boolean; holding?: string } = {}
): Promise< Markup[] > {
	const files = themeDir ? await themeMarkupFiles( themeDir ) : [];
	return [
		...files.map( ( file ) => ( { file, content: readFileSync( file, 'utf8' ) } ) ),
		...( posts
			? await readWordPressSite( siteRoot, ( site ) =>
					site.query< { post: number; type: string; content: string } >(
						`SELECT ID AS post, post_type AS type, post_content AS content FROM ${ site.prefix }posts WHERE ${ RENDERED } AND post_content LIKE ?`,
						...RENDERED_TYPES,
						holding
					)
			  )
			: [] ),
	];
}

/**
 * Saves a post's content from a file, as an administrator's save
 * in the editor does: through wp_update_post(), as the site's administrator,
 * and without the kses filters a user without unfiltered_html saves through
 * (kses_remove_filters()), which on a multisite only a super admin has.
 */
export async function savePost(
	host: StudioAgentHost,
	site: HostSite,
	id: number,
	file: string
): Promise< void > {
	const php = `${ AS_ADMINISTRATOR }
kses_remove_filters();
$saved = wp_update_post( wp_slash( array( 'ID' => ${ id }, 'post_content' => file_get_contents( ${ JSON.stringify(
		file
	) } ) ) ), true );
if ( is_wp_error( $saved ) ) { fwrite( STDERR, $saved->get_error_message() ); exit( 1 ); }`;
	await runWpCli( host, site, [ 'eval', php ] );
}

/** Saves new content to where a piece of markup is held: its file, or its post. */
export async function saveMarkup(
	host: StudioAgentHost,
	siteRoot: string,
	item: Markup,
	content: string
): Promise< void > {
	if ( item.file ) {
		await writeFile( item.file, content, 'utf8' );
		return;
	}
	const draft = path.join( siteRoot, 'tmp', `post-${ item.post }-${ process.pid }.html` );
	await mkdir( path.dirname( draft ), { recursive: true } );
	await writeFile( draft, content, 'utf8' );
	try {
		await savePost( host, await host.sites.resolve( siteRoot ), item.post!, draft );
	} finally {
		await rm( draft, { force: true } );
	}
}

/** Where a piece of markup is held, for a note. */
export const placeOf = ( item: Markup, from?: string ) =>
	item.file ? ( from ? path.relative( from, item.file ) : item.file ) : `post ${ item.post }`;
