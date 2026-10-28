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
} from '@studio/agent/node/block-validation-gate';
import { repeatedPostStyleNotes } from '@studio/agent/node/repeated-style-values';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { RENDERED, RENDERED_TYPES, savePost } from '@studio/agent/node/site-markup';
import { validationSummary } from '@studio/agent/node/studio-message';
import { runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

export interface Row {
	id: number;
	type: string;
	title: string;
	content: string;
}

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

// Saved templates and template parts that name no theme. WordPress serves one
// only for the theme its wp_theme term names (get_block_templates() in
// wp-includes/block-template-utils.php), so a copy saved without one, as `wp
// post create` saves it, replaces nothing.
function unthemedTemplates( sitePath: string, posts: Row[] ): Promise< Row[] > {
	const templates = posts.filter( ( post ) => TEMPLATE_TYPES.includes( post.type ) );
	if ( ! templates.length ) {
		return Promise.resolve( [] );
	}
	return readWordPressSite( sitePath, ( site ) => {
		const themed = new Set(
			site
				.query< { id: number } >(
					`SELECT tr.object_id AS id FROM ${ site.prefix }term_relationships tr
					JOIN ${
						site.prefix
					}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
					WHERE tr.object_id IN (${ templates.map( () => '?' ).join( ', ' ) })`,
					...templates.map( ( post ) => post.id )
				)
				.map( ( row ) => Number( row.id ) )
		);
		return templates.filter( ( post ) => ! themed.has( Number( post.id ) ) );
	} );
}

const TEMPLATE_TYPES = [ 'wp_template', 'wp_template_part' ];

// Gives each the active theme, as core gives a template part it creates
// (wp_set_unique_slug_on_create_template_part() in
// wp-includes/theme-templates.php) and the Site Editor's save gives a template
// (WP_REST_Templates_Controller::prepare_item_for_database()). Returns the theme.
async function giveActiveTheme(
	host: StudioAgentHost,
	site: HostSite,
	posts: Row[]
): Promise< string > {
	const php = `foreach ( array( ${ posts
		.map( ( post ) => Number( post.id ) )
		.join( ', ' ) } ) as $id ) { wp_set_post_terms( $id, get_stylesheet(), 'wp_theme' ); }
echo get_stylesheet();`;
	return ( await runWpCli( host, site, [ 'eval', php ] ) ).trim();
}

async function themeReport(
	host: StudioAgentHost,
	site: HostSite,
	posts: Row[]
): Promise< ChangeReport[] > {
	const unthemed = await unthemedTemplates( site.path, posts );
	if ( ! unthemed.length ) {
		return [];
	}
	const labels = unthemed.map(
		( post ) => `${ post.type } ${ post.id }${ post.title ? ` "${ post.title }"` : '' }`
	);
	const theme = await giveActiveTheme( host, site, unthemed ).catch( () => undefined );
	const cause = `${ site.name } ${ labels.join(
		', '
	) } named no theme, and WordPress serves a saved template or template part only for the theme its wp_theme term names (get_block_templates() in wp-includes/block-template-utils.php)`;
	return [
		theme
			? {
					key: `themes of ${ labels.join( ', ' ) }`,
					summary: `${ cause }. Studio gave ${
						unthemed.length === 1 ? 'it' : 'them'
					} the active theme, ${ theme }, as core gives a template part it creates (wp_set_unique_slug_on_create_template_part() in wp-includes/theme-templates.php) and the Site Editor's save gives a template (WP_REST_Templates_Controller in wp-includes/rest-api/endpoints/class-wp-rest-templates-controller.php).`,
			  }
			: {
					key: `themes of ${ labels.join( ', ' ) }`,
					summary: `${ cause }.`,
					problem: `${ cause }. Give each the theme it is for with \`wp post term set <ID> wp_theme <theme>\`.`,
			  },
	];
}

// A lossless fix is saved to the post, as Studio saves one to a file
// (block-validation-gate.ts). One Studio cannot save stays in the site's tmp/
// for the agent to apply; named by its absolute path, which holds whatever
// folder the agent's shell is in, with forward slashes, which the shell keeps
// where it reads a Windows backslash as an escape.
async function validatePost(
	host: StudioAgentHost,
	site: HostSite,
	post: Row
): Promise< Omit< ChangeReport, 'key' > & { saved?: boolean } > {
	const label = `${ site.name } ${ post.type } ${ post.id } "${ post.title }"`;
	// Before the presets the save stores its blocks with are read.
	const presetNotes = await repeatedPostStyleNotes(
		host,
		site.path,
		post.id,
		post.content,
		label
	).catch( () => [] );
	const result = await validateBlockMarkup(
		post.content,
		label,
		site.url,
		await sitePresetValues( host, site.path )
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
	const saved = await savePost( host, site, post.id, fixFile ).then(
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
	saves: true,
	read: readVersions,
	async check( site, before, after, host ) {
		const changed = Object.keys( after ).filter( ( id ) => before[ id ] !== after[ id ] );
		const reports: ChangeReport[] = [];
		let saved = false;
		const posts = changed.length ? await readPosts( site.path, changed ) : [];
		for ( const post of posts ) {
			const { saved: savedPost, ...result } = await validatePost( host, site, post ).catch(
				( error: unknown ) => ( {
					summary: `${ site.name } ${ post.type } ${ post.id }: not validated (${
						error instanceof Error ? error.message : String( error )
					})`,
					problem: undefined,
					saved: false,
				} )
			);
			saved = saved || !! savedPost;
			reports.push( {
				key: String( post.id ),
				...result,
				summary: result.summary && validationSummary( result.summary ),
			} );
		}
		reports.push( ...( await themeReport( host, site, posts ) ) );
		// The posts Studio saved are compared from what it saved.
		return { reports, next: saved ? await readVersions( site.path ) : undefined };
	},
};
