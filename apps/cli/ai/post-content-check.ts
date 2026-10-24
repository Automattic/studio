/**
 * Block validation of the content WordPress renders from the database: posts,
 * pages, templates, template parts, patterns and navigation menus. Content
 * reaches those rows by any route (WP-CLI with inline or file content, `wp
 * eval`, REST, an import), so it is checked where it lands, not on the way.
 *
 * Surfaces take a snapshot before a call and check after it, so what a call
 * changed is reported on that call's result.
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { validateBlockMarkup } from 'cli/ai/block-validation-gate';
import { readWordPressSite } from 'cli/ai/site-database';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import type { OpenProblems } from 'cli/ai/open-problems';

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

/**
 * Each rendered post's version, by post ID: its modified time and content
 * length, so a check reads the content of changed posts only.
 */
export type PostSnapshot = Record< string, string >;

const RENDERED = `post_type IN (${ RENDERED_TYPES.map( () => '?' ).join(
	', '
) }) AND post_status NOT IN ('auto-draft', 'inherit', 'trash')`;

async function readVersions( sitePath: string ): Promise< PostSnapshot > {
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

async function localSites(): Promise< SiteData[] > {
	return ( await readCliConfig() ).sites;
}

// A lossless fix is saved in the site's tmp/ for the agent to apply, since the
// row belongs to the running site; named by its absolute path, which holds
// whatever folder the agent's shell is in.
async function validatePost( site: SiteData, post: Row ) {
	const label = `${ site.name } ${ post.type } ${ post.id } "${ post.title }"`;
	const result = await validateBlockMarkup( post.content, label, getSiteUrl( site ) );
	if ( result.fixedContent === undefined ) {
		return result;
	}
	const fixFile = path.join( site.path, 'tmp', `${ post.type }-${ post.id }.html` );
	await mkdir( path.dirname( fixFile ), { recursive: true } );
	await writeFile( fixFile, result.fixedContent, 'utf8' );
	return {
		summary: `${ label }: ${ result.invalidBlocks } invalid block(s)`,
		problem: `${ label }: ${ result.invalidBlocks } block(s) do not match what the block saves; the block editor's fix loses nothing and is saved in ${ fixFile }. Apply it in the site's folder with \`wp post update ${ post.id } ${ fixFile }\`.`,
	};
}

export class PostContentCheck {
	constructor(
		private readonly snapshots = new Map< string, PostSnapshot >(),
		private readonly open?: OpenProblems,
		private readonly sites: () => Promise< SiteData[] > = localSites,
		private readonly validate: typeof validatePost = validatePost
	) {}

	/** Records every local site's rendered content as it is now. */
	async snapshot(): Promise< void > {
		for ( const site of await this.sites() ) {
			this.snapshots.set( site.path, await readVersions( site.path ) );
		}
	}

	/** Validates the content changed since the snapshot, and snapshots it. */
	async settle(): Promise< { summaries: string[]; problems: string[] } > {
		const summaries: string[] = [];
		const problems: string[] = [];
		for ( const site of await this.sites() ) {
			const before = this.snapshots.get( site.path );
			const after = await readVersions( site.path );
			this.snapshots.set( site.path, after );
			// A site first seen now has no changes yet.
			const changed = before
				? Object.keys( after ).filter( ( id ) => before[ id ] !== after[ id ] )
				: [];
			for ( const post of changed.length ? await readPosts( site.path, changed ) : [] ) {
				const result = await this.validate( site, post ).catch( ( error: unknown ) => ( {
					summary: `${ site.name } ${ post.type } ${ post.id }: not validated (${
						error instanceof Error ? error.message : String( error )
					})`,
					problem: undefined,
				} ) );
				this.open?.record( site.path, `${ site.path }#${ post.id }`, result.problem );
				summaries.push( result.summary );
				problems.push( ...( result.problem ? [ result.problem ] : [] ) );
			}
		}
		return { summaries, problems };
	}
}
