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
import { readWordPressSite } from 'cli/ai/site-database';
import { resolveSite } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteData } from 'cli/lib/cli-config/core';

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
	content: string;
}

/** A theme's template, template part and pattern files. */
async function themeMarkupFiles( themeDir: string ): Promise< string[] > {
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
					site.query< { post: number; content: string } >(
						`SELECT ID AS post, post_content AS content FROM ${ site.prefix }posts WHERE ${ RENDERED } AND post_content LIKE ?`,
						...RENDERED_TYPES,
						holding
					)
			  )
			: [] ),
	];
}

/**
 * Saves a post's content from a file, as an administrator's save
 * in the editor does: through wp_update_post(), without the kses filters a
 * user without unfiltered_html saves through (kses_remove_filters()).
 */
export async function savePost( site: SiteData, id: number, file: string ): Promise< void > {
	const php = `kses_remove_filters();
$saved = wp_update_post( wp_slash( array( 'ID' => ${ id }, 'post_content' => file_get_contents( ${ JSON.stringify(
		file
	) } ) ) ), true );
if ( is_wp_error( $saved ) ) { fwrite( STDERR, $saved->get_error_message() ); exit( 1 ); }`;
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [ 'eval', php ] );
		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			throw new Error( `wp eval exited ${ exitCode }` );
		}
	} finally {
		await disconnectFromDaemon();
	}
}

/** Saves new content to where a piece of markup is held: its file, or its post. */
export async function saveMarkup(
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
		await savePost( await resolveSite( siteRoot ), item.post!, draft );
	} finally {
		await rm( draft, { force: true } );
	}
}

/** Where a piece of markup is held, for a note. */
export const placeOf = ( item: Markup, from?: string ) =>
	item.file ? ( from ? path.relative( from, item.file ) : item.file ) : `post ${ item.post }`;
