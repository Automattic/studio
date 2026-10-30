/**
 * Block validation of the content WordPress renders from the database: posts,
 * pages, templates, template parts, patterns and navigation menus. Content
 * reaches those rows by any route (WP-CLI with inline or file content, `wp
 * eval`, REST, an import), so it is checked where it lands (site-changes.ts).
 */
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import {
	blockEditorOf,
	describeEditorSave,
	sitePresetValues,
	validateBlockMarkup,
} from '@studio/agent/node/block-validation-gate';
import { repeatedPostStyleNotes } from '@studio/agent/node/repeated-style-values';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { POST_VERSION, RENDERED, RENDERED_TYPES, savePost } from '@studio/agent/node/site-markup';
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

// The version of the code WordPress runs: its active plugins and theme. A call
// that activates or switches them runs their code, which can write posts of
// its own, as WooCommerce writes its Shop and Cart pages (WC_Install::create_pages()),
// in the same call as the agent writes its own: their fixes are stated, not saved.
const CODE = 'code';

// Each rendered post's content-sensitive version, by post ID.
export async function readVersions( sitePath: string ): Promise< Versions > {
	const rows = await readWordPressSite( sitePath, ( site ) =>
		site.query< { id: number; version: string } >(
			`SELECT ID AS id, ${ POST_VERSION } AS version
			FROM ${ site.prefix }posts WHERE ${ RENDERED }`,
			...RENDERED_TYPES
		)
	);
	return Object.fromEntries( rows.map( ( row ) => [ row.id, row.version ] ) );
}

// The posts' versions, and the code's.
async function readPostsAndCode( sitePath: string ): Promise< Versions > {
	const code = await readWordPressSite( sitePath, ( site ) =>
		JSON.stringify(
			[ 'active_plugins', 'template', 'stylesheet' ].map( ( name ) => site.option( name ) ?? null )
		)
	);
	return { ...( await readVersions( sitePath ) ), [ CODE ]: code };
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
	return withoutTerm(
		sitePath,
		posts.filter( ( post ) => TEMPLATE_TYPES.includes( post.type ) ),
		'wp_theme'
	);
}

// The posts with no term of `taxonomy`.
function withoutTerm( sitePath: string, posts: Row[], taxonomy: string ): Promise< Row[] > {
	if ( ! posts.length ) {
		return Promise.resolve( [] );
	}
	return readWordPressSite( sitePath, ( site ) => {
		const termed = new Set(
			site
				.query< { id: number } >(
					`SELECT tr.object_id AS id FROM ${ site.prefix }term_relationships tr
					JOIN ${
						site.prefix
					}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = ?
					WHERE tr.object_id IN (${ posts.map( () => '?' ).join( ', ' ) })`,
					taxonomy,
					...posts.map( ( post ) => post.id )
				)
				.map( ( row ) => Number( row.id ) )
		);
		return posts.filter( ( post ) => ! termed.has( Number( post.id ) ) );
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

// Gives each saved template part with no area the area of the theme's part
// it replaces, as the Site Editor's save does when it customizes a theme's
// part (WP_REST_Templates_Controller::prepare_item_for_database()). WordPress
// reads a saved part's area from its wp_template_part_area term only
// (_build_block_template_result_from_post()), and renders a part with none as
// uncategorized, in a <div> where a footer renders in <footer>
// (wp-includes/blocks/template-part.php). Returns the areas given, by post.
async function giveThemeArea(
	host: StudioAgentHost,
	site: HostSite,
	parts: Row[]
): Promise< Record< string, string > > {
	const php = `$given = array();
foreach ( array( ${ parts.map( ( post ) => Number( post.id ) ).join( ', ' ) } ) as $id ) {
	$theme = wp_get_post_terms( $id, 'wp_theme', array( 'fields' => 'names' ) );
	if ( has_term( '', 'wp_template_part_area', $id ) || ! $theme ) {
		continue;
	}
	$file = get_block_file_template( $theme[0] . '//' . get_post_field( 'post_name', $id ), 'wp_template_part' );
	if ( $file && ! empty( $file->area ) && WP_TEMPLATE_PART_AREA_UNCATEGORIZED !== $file->area ) {
		wp_set_post_terms( $id, $file->area, 'wp_template_part_area' );
		$given[ $id ] = $file->area;
	}
}
echo 'AREAS=' . wp_json_encode( (object) $given );`;
	const output = await runWpCli( host, site, [ 'eval', php ] );
	return JSON.parse( output.slice( output.indexOf( 'AREAS=' ) + 'AREAS='.length ).trim() );
}

async function areaReport(
	host: StudioAgentHost,
	site: HostSite,
	posts: Row[]
): Promise< ChangeReport[] > {
	// A part with an area keeps it, so only the parts with none are looked up.
	const parts = await withoutTerm(
		site.path,
		posts.filter( ( post ) => post.type === 'wp_template_part' ),
		'wp_template_part_area'
	);
	if ( ! parts.length ) {
		return [];
	}
	const given = await giveThemeArea( host, site, parts ).catch( () => ( {} ) );
	return Object.entries( given ).map( ( [ id, area ] ) => ( {
		key: `area of wp_template_part ${ id }`,
		summary: `${ site.name } wp_template_part ${ id } had no area, and WordPress reads a saved part's area from its wp_template_part_area term only (_build_block_template_result_from_post() in wp-includes/block-template-utils.php), rendering one with none in a <div> (wp-includes/blocks/template-part.php). Studio gave it the area of the theme's part it replaces, ${ area }, as the Site Editor's save does (WP_REST_Templates_Controller::prepare_item_for_database()).`,
	} ) );
}

// A lossless fix is saved to the post, as Studio saves one to a file
// (block-validation-gate.ts), unless code activated in the call may have
// written the post. One Studio does not save stays in the site's tmp/
// for the agent to apply; named by its absolute path, which holds whatever
// folder the agent's shell is in, with forward slashes, which the shell keeps
// where it reads a Windows backslash as an escape.
async function validatePost(
	host: StudioAgentHost,
	site: HostSite,
	post: Row,
	save: boolean
): Promise< Omit< ChangeReport, 'key' > & { saved?: boolean } > {
	// A post with no content yet, as `wp post create` makes one, has no blocks
	// to validate, and the editor is not loaded to find none.
	if ( ! post.content.trim() ) {
		return {};
	}
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
		await sitePresetValues( host, site.path ),
		blockEditorOf( post )
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
	const saved =
		save &&
		( await savePost( host, site, post.id, fixFile ).then(
			() => true,
			() => false
		) );
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
	read: readPostsAndCode,
	async check( site, before, after, host ) {
		const changed = Object.keys( after ).filter(
			( id ) => id !== CODE && before[ id ] !== after[ id ]
		);
		const reports: ChangeReport[] = [];
		let saved = false;
		const posts = changed.length ? await readPosts( site.path, changed ) : [];
		// What code activated in this call wrote is its own, and stays as it wrote it.
		const save = before[ CODE ] === after[ CODE ];
		for ( const post of posts ) {
			const { saved: savedPost, ...result } = await validatePost( host, site, post, save ).catch(
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
				post: post.id,
				...result,
				summary: result.summary && validationSummary( result.summary ),
			} );
		}
		reports.push( ...( await themeReport( host, site, posts ) ) );
		// Once each names its theme, whose part it replaces.
		reports.push( ...( await areaReport( host, site, posts ) ) );
		// The posts Studio saved are compared from what it saved.
		return { reports, next: saved ? await readPostsAndCode( site.path ) : undefined };
	},
};
