/**
 * Block validation of the content WordPress renders from the database: posts,
 * pages, templates, template parts, patterns and navigation menus. Content
 * reaches those rows by any route (WP-CLI with inline or file content, `wp
 * eval`, REST, an import), so it is checked where it lands (site-changes.ts).
 */
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { blockCodeVersion, seeBlockCode } from '@studio/agent/node/block-code';
import {
	blockEditorOf,
	blockStylesOn,
	describeCorrections,
	describeEditorSave,
	rendersAlikeOn,
	sitePresetValues,
	validateBlockMarkup,
} from '@studio/agent/node/block-validation-gate';
import { repeatedPostStyleNotes } from '@studio/agent/node/repeated-style-values';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { POST_VERSION, RENDERED, RENDERED_TYPES, savePost } from '@studio/agent/node/site-markup';
import { validationSummary } from '@studio/agent/shared/studio-message';
import { printedJson, wpEval } from '@studio/agent/shared/tools/utils';
import type { PresetValues } from '@studio/agent/node/block-validator';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

interface Row {
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
// The posts last validated with a problem, after the presets and block code
// they were validated with: a problem can name presets a later change to the
// theme adds, or a block its code registers in the editor since.
const OPEN = 'open';
const isPost = ( id: string ) => id !== CODE && id !== OPEN;

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
	return ( await wpEval( host, site, php ) ).trim();
}

async function themeReport(
	host: StudioAgentHost,
	site: HostSite,
	posts: Row[]
): Promise< ChangeReport[] > {
	// Saved templates and template parts that name no theme. WordPress serves one
	// only for the theme its wp_theme term names (get_block_templates() in
	// wp-includes/block-template-utils.php), so a copy saved without one, as `wp
	// post create` saves it, replaces nothing.
	const unthemed = await withoutTerm(
		site.path,
		posts.filter( ( post ) => TEMPLATE_TYPES.includes( post.type ) ),
		'wp_theme'
	);
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
	const output = await wpEval( host, site, php );
	return printedJson( output, 'AREAS=' );
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

type Validated = Omit< ChangeReport, 'key' > & { saved?: boolean };

// The posts validated side by side, at most this many at a time: each waits
// mostly on WP-CLI and the block editor, whose page takes calls side by side
// (EditorPage.use() in browser-utils.ts).
const SIDE_BY_SIDE = 3;

// Each post's validation, in the posts' order, `validate` running on at most
// SIDE_BY_SIDE of them at a time. A post's notes on the presets its repeated
// values became are made first, one post after another, as each can add to
// the theme's theme.json and save posts, and the posts are validated with
// the presets they leave. A post this validation saves is not saved for the
// presets before it.
async function validatePosts< R >(
	host: StudioAgentHost,
	site: HostSite,
	posts: Row[],
	save: boolean,
	validate: ( post: Row, run: () => Promise< Validated > ) => Promise< R >
): Promise< R[] > {
	const notes: string[][] = [];
	const savedAfter = save ? posts.map( ( post ) => Number( post.id ) ) : [];
	for ( const post of posts ) {
		notes.push( await presetNotesOf( host, site, post, savedAfter ) );
	}
	const presets = posts.some( ( post ) => ! isEmpty( post ) )
		? await sitePresetValues( host, site.path )
		: undefined;
	const results: R[] = [];
	let next = 0;
	const worker = async () => {
		for ( let i = next++; i < posts.length; i = next++ ) {
			results[ i ] = await validate( posts[ i ], () =>
				validatePost( host, site, posts[ i ], save, notes[ i ], presets )
			);
		}
	};
	await Promise.all( Array.from( { length: Math.min( SIDE_BY_SIDE, posts.length ) }, worker ) );
	return results;
}

const labelOf = ( site: HostSite, post: Row ) =>
	`${ site.name } ${ post.type } ${ post.id } "${ post.title }"`;

// A post with no content yet, as `wp post create` makes one, has no blocks
// to validate, and the editor is not loaded to find none.
const isEmpty = ( post: Row ) => ! post.content.trim();

// Before the presets the save stores its blocks with are read.
function presetNotesOf(
	host: StudioAgentHost,
	site: HostSite,
	post: Row,
	savedAfter: number[]
): Promise< string[] > {
	return isEmpty( post )
		? Promise.resolve( [] )
		: repeatedPostStyleNotes(
				host,
				site.path,
				post.id,
				post.content,
				labelOf( site, post ),
				savedAfter
		  ).catch( () => [] );
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
	save: boolean,
	presetNotes: string[],
	presets: PresetValues | undefined
): Promise< Validated > {
	if ( isEmpty( post ) || ! presets ) {
		return {};
	}
	const label = labelOf( site, post );
	const result = await validateBlockMarkup(
		post.content,
		label,
		site.url,
		presets,
		blockEditorOf( post ),
		rendersAlikeOn( host, site ),
		// A block style is written to the theme only for a fix Studio saves.
		save ? await blockStylesOn( site.path ) : undefined
	);
	// Sentences of their own, after the one they follow.
	const sentences = ( notes: string[] ) => ( notes.length ? `. ${ notes.join( ' ' ) }` : '' );
	if ( result.fixedContent === undefined ) {
		return { ...result, summary: result.summary + sentences( presetNotes ) };
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
			) }, losing nothing, so it now holds what the editor saves${ sentences( [
				...( result.corrections ?? [] ),
				...presetNotes,
			] ) }`,
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
			} ${ shellPath }\`${ describeCorrections( result ) || '.' }`,
			...( result.problem ? [ result.problem ] : [] ),
		].join( '\n' ),
	};
}

export const postContentChanges: SiteChangeSource = {
	name: 'posts',
	saves: true,
	async read( sitePath, last ) {
		return {
			...( await readPostsAndCode( sitePath ) ),
			...( last?.[ OPEN ] && { [ OPEN ]: last[ OPEN ] } ),
		};
	},
	async check( site, before, after, host ) {
		const changed = Object.keys( after ).filter(
			( id ) => isPost( id ) && before[ id ] !== after[ id ]
		);
		const presetsAndCodeNow = async () => {
			const code = await blockCodeVersion( site.path ).catch( () => '' );
			if ( code ) {
				seeBlockCode( site.url, code );
			}
			return JSON.stringify( [ await sitePresetValues( host, site.path ), code ] );
		};
		// The posts left with a problem that did not change, validated again
		// when the presets or the block code changed.
		const [ validatedWith, ...open ] = JSON.parse( before[ OPEN ] ?? '[""]' ) as string[];
		const unchanged = open.filter( ( id ) => id in after && ! changed.includes( id ) );
		const recheck =
			unchanged.length && ( await presetsAndCodeNow() ) !== validatedWith ? unchanged : [];
		// A post deleted or trashed has no problem left on the site.
		const reports: ChangeReport[] = Object.keys( before )
			.filter( ( id ) => isPost( id ) && ! ( id in after ) )
			.map( ( id ) => ( { key: id } ) );
		const stillOpen = unchanged.filter( ( id ) => ! recheck.includes( id ) );
		let saved = false;
		const posts = changed.length ? await readPosts( site.path, changed ) : [];
		// What code activated in this call wrote is its own, and stays as it wrote it.
		const save = before[ CODE ] === after[ CODE ];
		const validated = await validatePosts( host, site, posts, save, ( post, run ) =>
			run().catch( ( error: unknown ) => ( {
				summary: `${ site.name } ${ post.type } ${ post.id }: not validated (${
					error instanceof Error ? error.message : String( error )
				})`,
				problem: undefined,
				saved: false,
			} ) )
		);
		for ( const [ i, post ] of posts.entries() ) {
			const { saved: savedPost, ...result } = validated[ i ];
			saved = saved || !! savedPost;
			if ( result.problem ) {
				stillOpen.push( String( post.id ) );
			}
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
		// A post validated again for the presets: its problem is updated, and not told again.
		const rechecked = recheck.length ? await readPosts( site.path, recheck ) : [];
		const revalidated = await validatePosts( host, site, rechecked, false, ( _post, run ) =>
			run().catch( () => undefined )
		);
		for ( const [ i, post ] of rechecked.entries() ) {
			const result = revalidated[ i ];
			if ( ! result || result.problem ) {
				stillOpen.push( String( post.id ) );
			}
			if ( result ) {
				reports.push( { key: String( post.id ), problem: result.problem, atTurnEnd: true } );
			}
		}
		// The posts Studio saved are compared from what it saved.
		return {
			reports,
			next: {
				...( saved ? await readPostsAndCode( site.path ) : after ),
				[ OPEN ]: JSON.stringify( [
					stillOpen.length ? await presetsAndCodeNow() : '',
					...stillOpen,
				] ),
			},
		};
	},
};
