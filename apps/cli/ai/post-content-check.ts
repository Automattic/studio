/**
 * Block validation of the content WordPress renders from the database: posts,
 * pages, templates, template parts, patterns and navigation menus. Content
 * reaches those rows by any route (WP-CLI with inline or file content, `wp
 * eval`, REST, an import), so it is checked where it lands (site-changes.ts).
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import {
	describePaletteColors,
	sitePalette,
	validateBlockMarkup,
} from 'cli/ai/block-validation-gate';
import { readWordPressSite } from 'cli/ai/site-database';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import type { ChangeReport, SiteChangeSource, Versions } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

const RENDERED_TYPES = [
	'post',
	'page',
	'wp_template',
	'wp_template_part',
	'wp_block',
	'wp_navigation',
];

interface Row {
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
async function readVersions( sitePath: string ): Promise< Versions > {
	const rows = await readWordPressSite( sitePath, ( site ) =>
		site.query< { id: number; version: string } >(
			`SELECT ID AS id, post_modified_gmt || ' ' || length(post_content) AS version
			FROM ${ site.prefix }posts WHERE ${ RENDERED }`,
			...RENDERED_TYPES
		)
	);
	return Object.fromEntries( rows.map( ( row ) => [ row.id, row.version ] ) );
}

async function readPosts( sitePath: string, ids: string[] ): Promise< Row[] > {
	return readWordPressSite( sitePath, ( site ) =>
		site.query< Row >(
			`SELECT ID AS id, post_type AS type, post_title AS title, post_content AS content
			FROM ${ site.prefix }posts WHERE ID IN (${ ids.map( () => '?' ).join( ', ' ) })`,
			...ids
		)
	);
}

// A lossless fix is saved in the site's tmp/ for the agent to apply, since the
// row belongs to the running site; named by its absolute path, which holds
// whatever folder the agent's shell is in, with forward slashes, which the
// shell keeps where it reads a Windows backslash as an escape.
async function validatePost( site: SiteData, post: Row ) {
	const label = `${ site.name } ${ post.type } ${ post.id } "${ post.title }"`;
	const result = await validateBlockMarkup(
		post.content,
		label,
		getSiteUrl( site ),
		await sitePalette( site.path )
	);
	if ( result.fixedContent === undefined ) {
		return result;
	}
	const fixFile = path.join( site.path, 'tmp', `${ post.type }-${ post.id }.html` );
	await mkdir( path.dirname( fixFile ), { recursive: true } );
	await writeFile( fixFile, result.fixedContent, 'utf8' );
	const shellPath = fixFile.split( path.sep ).join( '/' );
	const saves = [
		result.invalidBlocks
			? `fixes ${ result.invalidBlocks } block(s) that do not match what the block saves`
			: undefined,
		result.paletteColors?.length ? describePaletteColors( result.paletteColors ) : undefined,
	].filter( Boolean );
	return {
		summary: result.invalidBlocks
			? `${ label }: ${ result.invalidBlocks } invalid block(s)`
			: result.summary,
		problem: `${ label }: the block editor's save ${ saves.join(
			' and '
		) }, losing nothing; it is saved in ${ shellPath }. Apply it in the site's folder with \`wp post update ${
			post.id
		} ${ shellPath }\`.`,
	};
}

export const postContentChanges: SiteChangeSource = {
	name: 'posts',
	read: readVersions,
	async check( site, before, after ) {
		const changed = Object.keys( after ).filter( ( id ) => before[ id ] !== after[ id ] );
		const reports: ChangeReport[] = [];
		for ( const post of changed.length ? await readPosts( site.path, changed ) : [] ) {
			const result = await validatePost( site, post ).catch( ( error: unknown ) => ( {
				summary: `${ site.name } ${ post.type } ${ post.id }: not validated (${
					error instanceof Error ? error.message : String( error )
				})`,
				problem: undefined,
			} ) );
			reports.push( { key: String( post.id ), ...result } );
		}
		return { reports };
	},
};
