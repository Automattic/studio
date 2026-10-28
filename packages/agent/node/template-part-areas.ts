/**
 * The areas of a block theme's template parts, declared in its theme.json.
 * WordPress gives a theme's part file its area only from the theme.json
 * templateParts entry of that name (_add_block_template_part_area_info() in
 * wp-includes/block-template-utils.php); the area attribute of a template-part
 * block sets none. A part with no entry is uncategorized: core renders it in a
 * <div> where a header part renders in <header> and a footer part in <footer>
 * (wp-includes/blocks/template-part.php), and the Site Editor lists it under
 * General.
 *
 * When a theme's templates and parts include one of its parts with a core
 * area its theme.json does not declare, Studio adds the entry that area
 * states, as Twenty Twenty-Five's theme.json declares its header, and says so.
 */
import { readFile, readdir, stat, writeFile } from 'fs/promises';
import path from 'path';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

// The areas core defines with a tag of their own (get_allowed_block_template_part_areas()).
const AREAS = [ 'header', 'footer', 'navigation-overlay' ];
const PART = /<!--\s*wp:template-part\s+(\{.*?\})\s*\/?-->/g;

const htmlFiles = async ( dir: string ) =>
	( await readdir( dir ).catch( () => [] as string[] ) )
		.filter( ( file ) => file.endsWith( '.html' ) )
		.sort()
		.map( ( file ) => path.join( dir, file ) );

const markupFiles = async ( dir: string ) => [
	...( await htmlFiles( path.join( dir, 'templates' ) ) ),
	...( await htmlFiles( path.join( dir, 'parts' ) ) ),
];

/**
 * The template parts with no theme.json entry, by slug, with the area the
 * blocks that include them state: parts of this theme whose file it has.
 */
async function undeclaredAreas(
	dir: string,
	theme: string,
	declared: string[]
): Promise< Map< string, string > > {
	const areas = new Map< string, string >();
	for ( const file of await markupFiles( dir ) ) {
		const markup = await readFile( file, 'utf8' ).catch( () => '' );
		for ( const [ , json ] of markup.matchAll( PART ) ) {
			let attributes: { slug?: unknown; area?: unknown; theme?: unknown };
			try {
				attributes = JSON.parse( json );
			} catch {
				continue;
			}
			const { slug, area, theme: of = theme } = attributes;
			if (
				typeof slug === 'string' &&
				typeof area === 'string' &&
				AREAS.includes( area ) &&
				of === theme &&
				! declared.includes( slug ) &&
				( await stat( path.join( dir, 'parts', `${ slug }.html` ) ).then( Boolean, () => false ) )
			) {
				areas.set( slug, area );
			}
		}
	}
	return areas;
}

// A part's title from its slug, as Twenty Twenty-Five titles "vertical-header".
const titleOf = ( slug: string ) => {
	const words = slug.replace( /[-_]+/g, ' ' );
	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );
};

export const templatePartAreas: SiteChangeSource = {
	name: 'template-part-areas',
	saves: true,
	async read( sitePath ) {
		const root = path.join( sitePath, 'wp-content', 'themes' );
		const versions: Versions = {};
		for ( const theme of await readdir( root ).catch( () => [] as string[] ) ) {
			const stamps = await Promise.all(
				[
					path.join( root, theme, 'theme.json' ),
					...( await markupFiles( path.join( root, theme ) ) ),
				].map( ( file ) =>
					stat( file ).then(
						( { mtimeMs, size } ) => `${ path.basename( file ) }:${ mtimeMs }:${ size }`,
						() => ''
					)
				)
			);
			if ( stamps[ 0 ] ) {
				versions[ theme ] = stamps.join( '|' );
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
			const dir = path.join( site.path, 'wp-content', 'themes', theme );
			const file = path.join( dir, 'theme.json' );
			let json: { templateParts?: Array< { name?: unknown } > };
			try {
				json = JSON.parse( await readFile( file, 'utf8' ) );
			} catch {
				continue;
			}
			if ( typeof json !== 'object' || json === null || Array.isArray( json ) ) {
				continue;
			}
			const parts = Array.isArray( json.templateParts ) ? json.templateParts : [];
			const areas = await undeclaredAreas(
				dir,
				theme,
				parts.map( ( part ) => String( part?.name ) )
			);
			if ( ! areas.size ) {
				continue;
			}
			json.templateParts = [
				...parts,
				...[ ...areas ].map( ( [ name, area ] ) => ( { area, name, title: titleOf( name ) } ) ),
			];
			await writeFile( file, `${ JSON.stringify( json, null, '\t' ) }\n` );
			const list = [ ...areas ].map( ( [ name, area ] ) => `${ name } (${ area })` ).join( ', ' );
			reports.push( {
				key: `template part areas of ${ theme }`,
				summary: `WordPress gives a theme's part its area only from theme.json templateParts (_add_block_template_part_area_info() in wp-includes/block-template-utils.php), so ${ theme }'s ${ list } rendered in a <div> (wp-includes/blocks/template-part.php). Studio added ${
					areas.size === 1 ? 'its entry' : 'their entries'
				} to wp-content/themes/${ theme }/theme.json, as Twenty Twenty-Five's theme.json declares its header, with the area the template-part blocks state.`,
			} );
		}
		return { reports };
	},
};
