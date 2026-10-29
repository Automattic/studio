/**
 * Template parts a block theme's templates include that WordPress has none
 * of. A template-part block renders a published wp_template_part post of the
 * active theme with its slug, else the theme's part file of that slug, from
 * the theme's parts folder or its parent's (_get_block_template_file() in
 * wp-includes/block-template-utils.php), and renders nothing when it has
 * neither, or names another theme than the active one
 * (render_block_core_template_part() in wp-includes/blocks/template-part.php).
 * So a header written to templates/header.html, a template, leaves the page
 * with no header.
 *
 * When a call changes a theme's templates or parts, Studio says which parts
 * they include that render nothing, and keeps the problem open until the turn
 * ends with each resolved, as the parts can follow the templates.
 */
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { isUpdatableTheme, readThemeHeader } from '@studio/agent/node/themes';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const PART = /<!--\s*wp:template-part\s+(\{.*?\})\s*\/?-->/g;
// A block theme's folders, and those of themes from before WordPress 5.9
// (WP_Theme::get_block_template_folders() in wp-includes/class-wp-theme.php).
const TEMPLATE_FOLDERS = [ 'templates', 'block-templates' ];
const PART_FOLDERS = [ 'parts', 'block-template-parts' ];

const exists = ( file: string ) => stat( file ).then( Boolean, () => false );

const htmlFiles = async ( dir: string, folders: string[] ) =>
	(
		await Promise.all(
			folders.map( async ( folder ) =>
				( await readdir( path.join( dir, folder ) ).catch( () => [] as string[] ) )
					.filter( ( file ) => file.endsWith( '.html' ) )
					.sort()
					.map( ( file ) => `${ folder }/${ file }` )
			)
		)
	).flat();

/** A part a theme file includes that renders nothing: what includes it, and why. */
interface MissingPart {
	file: string;
	slug: string;
	// The other theme the block names, when it names one.
	theme?: string;
}

async function missingParts( root: string, theme: string ): Promise< MissingPart[] > {
	const themes = path.join( root, 'wp-content', 'themes' );
	const dir = path.join( themes, theme );
	const parent = await readThemeHeader( root, theme, 'Template' ).catch( () => '' );
	const homes = [ dir, ...( parent && parent !== theme ? [ path.join( themes, parent ) ] : [] ) ];
	const missing: MissingPart[] = [];
	for ( const file of await htmlFiles( dir, [ ...TEMPLATE_FOLDERS, ...PART_FOLDERS ] ) ) {
		const markup = await readFile( path.join( dir, file ), 'utf8' ).catch( () => '' );
		for ( const [ , json ] of markup.matchAll( PART ) ) {
			let attributes: { slug?: unknown; theme?: unknown };
			try {
				attributes = JSON.parse( json );
			} catch {
				continue;
			}
			const { slug, theme: of = theme } = attributes;
			if ( typeof slug !== 'string' || ! slug ) {
				continue;
			}
			if ( of !== theme ) {
				missing.push( { file, slug, theme: String( of ) } );
				continue;
			}
			const files = homes.flatMap( ( home ) =>
				PART_FOLDERS.map( ( folder ) => path.join( home, folder, `${ slug }.html` ) )
			);
			if ( ! ( await Promise.all( files.map( exists ) ) ).some( Boolean ) ) {
				missing.push( { file, slug } );
			}
		}
	}
	const unfiled = [
		...new Set( missing.filter( ( part ) => ! part.theme ).map( ( p ) => p.slug ) ),
	];
	if ( ! unfiled.length ) {
		return missing;
	}
	// The parts saved to the site, as the Site Editor saves a part of the theme.
	const saved = await readWordPressSite( root, ( site ) =>
		site
			.query< { slug: string } >(
				`SELECT p.post_name AS slug FROM ${ site.prefix }posts p
				JOIN ${ site.prefix }term_relationships r ON r.object_id = p.ID
				JOIN ${ site.prefix }term_taxonomy x ON x.term_taxonomy_id = r.term_taxonomy_id AND x.taxonomy = 'wp_theme'
				JOIN ${ site.prefix }terms t ON t.term_id = x.term_id AND t.name = ?
				WHERE p.post_type = 'wp_template_part' AND p.post_status = 'publish'`,
				theme
			)
			.map( ( row ) => row.slug )
	);
	return missing.filter( ( part ) => part.theme || ! saved.includes( part.slug ) );
}

const list = ( items: string[] ) => [ ...new Set( items ) ].join( ', ' );

async function describe( root: string, theme: string, missing: MissingPart[] ): Promise< string > {
	const dir = path.join( root, 'wp-content', 'themes', theme );
	const sentences: string[] = [];
	const unfiled = missing.filter( ( part ) => ! part.theme );
	if ( unfiled.length ) {
		const slugs = [ ...new Set( unfiled.map( ( part ) => part.slug ) ) ];
		// A part written where WordPress reads templates.
		const templates = (
			await Promise.all(
				slugs.map( async ( slug ) =>
					( await exists( path.join( dir, 'templates', `${ slug }.html` ) ) )
						? `templates/${ slug }.html`
						: ''
				)
			)
		).filter( Boolean );
		sentences.push(
			`${ list( unfiled.map( ( part ) => part.file ) ) } of wp-content/themes/${ theme } include${
				unfiled.length === 1 ? 's' : ''
			} the template part${ slugs.length === 1 ? '' : 's' } ${ list(
				slugs
			) }, which the theme has no parts/ file of (${ list(
				slugs.map( ( slug ) => `parts/${ slug }.html` )
			) }) and the site no saved wp_template_part of. WordPress reads a theme's parts from its parts/ folder, as Twenty Twenty-Five's parts/header.html, and renders a part it has none of as nothing (_get_block_template_file() in wp-includes/block-template-utils.php, render_block_core_template_part() in wp-includes/blocks/template-part.php).${
				templates.length
					? ` ${ list( templates ) } ${
							templates.length === 1 ? 'is a template' : 'are templates'
					  }, which WordPress renders for the page of that name, not as a part.`
					: ''
			}`
		);
	}
	const elsewhere = missing.filter( ( part ) => part.theme );
	if ( elsewhere.length ) {
		sentences.push(
			`${ list( elsewhere.map( ( part ) => part.file ) ) } of wp-content/themes/${ theme } include${
				elsewhere.length === 1 ? 's' : ''
			} ${ list(
				elsewhere.map( ( part ) => `${ part.slug } of the theme ${ part.theme }` )
			) }, and WordPress renders a part of a theme other than the active one as nothing (render_block_core_template_part() in wp-includes/blocks/template-part.php). Twenty Twenty-Five's templates name only the slug: <!-- wp:template-part {"slug":"header"} /-->.`
		);
	}
	return sentences.join( ' ' );
}

const key = ( part: MissingPart ) => `${ part.file } ${ part.slug } ${ part.theme ?? '' }`;

export const missingTemplateParts: SiteChangeSource = {
	name: 'missing template parts',
	async read( sitePath ) {
		const root = path.join( sitePath, 'wp-content', 'themes' );
		const versions: Versions = {};
		for ( const theme of await readdir( root ).catch( () => [] as string[] ) ) {
			// A folder with a style.css is a theme (WP_Theme in wp-includes/class-wp-theme.php).
			if ( await exists( path.join( root, theme, 'style.css' ) ) ) {
				versions[ theme ] = JSON.stringify( await missingParts( sitePath, theme ) );
			}
		}
		return versions;
	},
	async check( site, before, after ) {
		const reports = [];
		for ( const theme of Object.keys( after ) ) {
			if ( before[ theme ] === after[ theme ] || ( await isUpdatableTheme( site.path, theme ) ) ) {
				continue;
			}
			const missing: MissingPart[] = JSON.parse( after[ theme ] );
			const was = new Set( ( JSON.parse( before[ theme ] ?? '[]' ) as MissingPart[] ).map( key ) );
			const added = missing.filter( ( part ) => ! was.has( key( part ) ) );
			const problem = missing.length
				? `${ await describe(
						site.path,
						theme,
						missing
				  ) } Write each part to the theme's parts/ folder and include it by its slug, or take its block out.`
				: undefined;
			reports.push( {
				key: `missing template parts of ${ theme }`,
				summary: added.length ? await describe( site.path, theme, added ) : undefined,
				problem,
				atTurnEnd: true,
			} );
		}
		return { reports };
	},
};
