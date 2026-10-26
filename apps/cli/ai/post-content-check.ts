/**
 * Block validation of the content WordPress renders from the database: posts,
 * pages, templates, template parts, patterns and navigation menus. Content
 * reaches those rows by any route (WP-CLI with inline or file content, `wp
 * eval`, REST, an import), so it is checked where it lands (site-changes.ts).
 */
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import {
	describeEditorSave,
	sitePresetValues,
	validateBlockMarkup,
} from 'cli/ai/block-validation-gate';
import { repeatedPostStyleNotes } from 'cli/ai/repeated-style-values';
import { readWordPressSite } from 'cli/ai/site-database';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { ChangeReport, SiteChangeSource, Versions } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

export const RENDERED_TYPES = [
	'post',
	'page',
	'wp_template',
	'wp_template_part',
	'wp_block',
	'wp_navigation',
];

export interface Row {
	id: number;
	type: string;
	title: string;
	content: string;
}

const RENDERED = `post_type IN (${ RENDERED_TYPES.map( () => '?' ).join(
	', '
) }) AND post_status NOT IN ('auto-draft', 'inherit', 'trash')`;

// Each rendered post's version, by post ID: its modified time and content
// length, so a check reads the content of changed posts only.
export async function readVersions( sitePath: string ): Promise< Versions > {
	const rows = await readWordPressSite( sitePath, ( site ) =>
		site.query< { id: number; version: string } >(
			`SELECT ID AS id, post_modified_gmt || ' ' || length(post_content) AS version
			FROM ${ site.prefix }posts WHERE ${ RENDERED }`,
			...RENDERED_TYPES
		)
	);
	return Object.fromEntries( rows.map( ( row ) => [ row.id, row.version ] ) );
}

export async function readPosts( sitePath: string, ids: string[] ): Promise< Row[] > {
	return readWordPressSite( sitePath, ( site ) =>
		site.query< Row >(
			`SELECT ID AS id, post_type AS type, post_title AS title, post_content AS content
			FROM ${ site.prefix }posts WHERE ID IN (${ ids.map( () => '?' ).join( ', ' ) })`,
			...ids
		)
	);
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

// A lossless fix is saved to the post, as Studio saves one to a file
// (block-validation-gate.ts). One Studio cannot save stays in the site's tmp/
// for the agent to apply; named by its absolute path, which holds whatever
// folder the agent's shell is in, with forward slashes, which the shell keeps
// where it reads a Windows backslash as an escape.
async function validatePost(
	site: SiteData,
	post: Row
): Promise< Omit< ChangeReport, 'key' > & { saved?: boolean } > {
	const label = `${ site.name } ${ post.type } ${ post.id } "${ post.title }"`;
	// Before the presets the save stores its blocks with are read.
	const presetNotes = await repeatedPostStyleNotes( site.path, post.content, label ).catch(
		() => []
	);
	const result = await validateBlockMarkup(
		post.content,
		label,
		getSiteUrl( site ),
		await sitePresetValues( site.path )
	);
	const madeNotes = presetNotes.length ? `. ${ presetNotes.join( ' ' ) }` : '';
	if ( result.fixedContent === undefined ) {
		return { ...result, summary: result.summary + madeNotes };
	}
	const relativePath = `tmp/${ post.type }-${ post.id }.html`;
	const fixFile = path.join( site.path, relativePath );
	await mkdir( path.dirname( fixFile ), { recursive: true } );
	await writeFile( fixFile, result.fixedContent, 'utf8' );
	const saves = describeEditorSave( result, ' that do not match what the block saves' );
	const saved = await savePost( site, post.id, fixFile ).then(
		() => true,
		() => false
	);
	if ( saved ) {
		await rm( fixFile, { force: true } );
		return {
			summary: `${ label }: Studio saved the block editor's save of it, which ${ saves.join(
				' and '
			) }, losing nothing, so it now holds what the editor saves${ madeNotes }`,
			problem: result.problem,
			saved: true,
		};
	}
	const shellPath = fixFile.split( path.sep ).join( '/' );
	return {
		summary: result.invalidBlocks
			? `${ label }: ${ result.invalidBlocks } invalid block(s)`
			: result.summary,
		problem: [
			`${ label }: the block editor's save ${ saves.join(
				' and '
			) }, losing nothing; it is saved in ${ shellPath }. Apply it in the site's folder with \`wp post update ${
				post.id
			} ${ shellPath }\`.`,
			...( result.problem ? [ result.problem ] : [] ),
		].join( '\n' ),
	};
}

export const postContentChanges: SiteChangeSource = {
	name: 'posts',
	read: readVersions,
	async check( site, before, after ) {
		const changed = Object.keys( after ).filter( ( id ) => before[ id ] !== after[ id ] );
		const reports: ChangeReport[] = [];
		let saved = false;
		for ( const post of changed.length ? await readPosts( site.path, changed ) : [] ) {
			const { saved: savedPost, ...result } = await validatePost( site, post ).catch(
				( error: unknown ) => ( {
					summary: `${ site.name } ${ post.type } ${ post.id }: not validated (${
						error instanceof Error ? error.message : String( error )
					})`,
					problem: undefined,
					saved: false,
				} )
			);
			saved = saved || !! savedPost;
			reports.push( { key: String( post.id ), ...result } );
		}
		// The posts Studio saved are compared from what it saved.
		return { reports, next: saved ? await readVersions( site.path ) : undefined };
	},
};
