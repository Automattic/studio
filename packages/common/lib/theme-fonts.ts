import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A theme.json `fontFace` entry. */
export interface ThemeFontFace {
	fontFamily: string;
	fontStyle: string;
	fontWeight: string;
	src: string[];
	unicodeRange?: string;
}

interface StylesheetFace {
	family: string;
	style: string;
	weights: number[];
	url: string;
	unicodeRange?: string;
	subset?: string;
}

// Google Fonts only serves woff2 files split into unicode-range subsets to
// browsers it recognizes; other clients get one full TrueType file per weight.
const BROWSER_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const slugify = ( name: string ) =>
	name
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );

async function fetchOk( url: string, init?: RequestInit ): Promise< Response > {
	const response = await fetch( url, init );
	if ( ! response.ok ) {
		throw new Error( `${ url } responded with HTTP ${ response.status }` );
	}
	return response;
}

/**
 * Reads the @font-face rules of a Google Fonts stylesheet. Weights that share a
 * file — a variable font — come back as one face.
 */
function parseFontFaces( css: string ): StylesheetFace[] {
	const faces = new Map< string, StylesheetFace >();
	for ( const [ , subset, body ] of css.matchAll(
		/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
	) ) {
		const read = ( property: string ) =>
			body.match( new RegExp( `${ property }:\\s*([^;]+);` ) )?.[ 1 ].trim();
		const url = body.match( /url\(\s*['"]?([^'")]+)['"]?\s*\)/ )?.[ 1 ];
		const family = read( 'font-family' )?.replace( /^['"]|['"]$/g, '' );
		if ( ! url || ! family ) {
			continue;
		}
		const style = read( 'font-style' ) ?? 'normal';
		const weight = Number( read( 'font-weight' ) ?? 400 );
		const face = faces.get( `${ url } ${ style }` );
		if ( face ) {
			face.weights.push( weight );
		} else {
			faces.set( `${ url } ${ style }`, {
				family,
				style,
				weights: [ weight ],
				url,
				unicodeRange: read( 'unicode-range' ),
				subset,
			} );
		}
	}
	return [ ...faces.values() ];
}

/**
 * Downloads the font files behind a Google Fonts stylesheet URL into the theme's
 * assets/fonts directory and returns the theme.json `fontFace` entries, keyed by
 * family name, pointing at them.
 */
export async function downloadThemeFonts(
	stylesheetUrl: string,
	themeDir: string
): Promise< Record< string, ThemeFontFace[] > > {
	const response = await fetchOk( stylesheetUrl, {
		headers: { 'User-Agent': BROWSER_USER_AGENT },
	} );
	const faces = parseFontFaces( await response.text() ).map( ( face ) => {
		const min = Math.min( ...face.weights );
		const max = Math.max( ...face.weights );
		const familySlug = slugify( face.family );
		const fileName = [
			familySlug,
			min === max ? min : `${ min }-${ max }`,
			face.style === 'normal' ? undefined : face.style,
			face.subset,
		]
			.filter( Boolean )
			.join( '-' );
		return {
			...face,
			fontWeight: min === max ? String( min ) : `${ min } ${ max }`,
			file: path.posix.join( 'assets', 'fonts', familySlug, `${ fileName }.woff2` ),
		};
	} );
	if ( ! faces.length ) {
		throw new Error( `${ stylesheetUrl } declares no font files` );
	}

	await Promise.all(
		faces.map( async ( face ) => {
			const data = Buffer.from( await ( await fetchOk( face.url ) ).arrayBuffer() );
			await mkdir( path.join( themeDir, path.dirname( face.file ) ), { recursive: true } );
			await writeFile( path.join( themeDir, face.file ), data );
		} )
	);

	const fonts: Record< string, ThemeFontFace[] > = {};
	for ( const face of faces ) {
		( fonts[ face.family ] ??= [] ).push( {
			fontFamily: face.family,
			fontStyle: face.style,
			fontWeight: face.fontWeight,
			src: [ `file:./${ face.file }` ],
			...( face.unicodeRange && { unicodeRange: face.unicodeRange } ),
		} );
	}
	return fonts;
}

interface FontFamilyPreset {
	slug?: string;
	name?: string;
	fontFamily?: string;
	fontFace?: unknown[];
}

export interface SelfHostedFonts {
	/** Families whose font files were downloaded and declared. */
	hosted: string[];
	/** Of those, the families whose fontFace named files the theme does not have. */
	missing: string[];
	/** Families whose first font Google Fonts had no files for, with why. */
	failed: { family: string; font: string; error: string }[];
}

// Every weight a theme.json's styles set, and 400. Styles inherit their font
// family, so a weight set on its own can still be a weight of any family.
function weightsOf( styles: unknown ): string[] {
	const weights = new Set< string >( [ '400' ] );
	const walk = ( node: unknown ) => {
		if ( ! node || typeof node !== 'object' ) {
			return;
		}
		const { fontWeight } = node as { fontWeight?: unknown };
		if ( /^\d{3}$/.test( String( fontWeight ) ) ) {
			weights.add( String( fontWeight ) );
		}
		Object.values( node ).forEach( walk );
	};
	walk( styles );
	return [ ...weights ].sort();
}

// Whether a family's fontFace names a "file:./" source that is not a file of the
// theme or of its parent, where WordPress looks for it: WP_Font_Face_Resolver's
// to_theme_file_uri() (wp-includes/fonts/class-wp-font-face-resolver.php) takes
// it through get_theme_file_uri() (wp-includes/link-template.php).
async function namesMissingFiles( family: FontFamilyPreset, dirs: string[] ): Promise< boolean > {
	const files = ( family.fontFace ?? [] ).flatMap( ( face ) => {
		const src = ( face as { src?: unknown } )?.src;
		return ( Array.isArray( src ) ? src : [ src ] ).filter(
			( file ): file is string => typeof file === 'string' && file.startsWith( 'file:./' )
		);
	} );
	const found = await Promise.all(
		files.map( async ( file ) => {
			for ( const dir of dirs ) {
				if (
					await access( path.join( dir, file.slice( 'file:./'.length ) ) ).then(
						() => true,
						() => false
					)
				) {
					return true;
				}
			}
			return false;
		} )
	);
	return found.includes( false );
}

// The theme's folder, then its parent's, by the Template header of its style.css.
async function themeDirs( themeDir: string ): Promise< string[] > {
	const css = await readFile( path.join( themeDir, 'style.css' ), 'utf8' ).catch( () => '' );
	const parent = css.match( /^[ \t/*#@]*Template:(.*)$/im )?.[ 1 ].trim();
	return parent ? [ themeDir, path.join( path.dirname( themeDir ), parent ) ] : [ themeDir ];
}

/**
 * Self-hosts a theme's fonts: each font family preset in its theme.json that
 * declares no font files, or names files the theme does not have, gets them
 * from Google Fonts, in the weights its styles use, downloaded into
 * assets/fonts and declared as its `fontFace`.
 */
export async function selfHostThemeJsonFonts( themeDir: string ): Promise< SelfHostedFonts > {
	const themeJsonPath = path.join( themeDir, 'theme.json' );
	const themeJson = JSON.parse( await readFile( themeJsonPath, 'utf8' ) );
	const families: FontFamilyPreset[] = themeJson?.settings?.typography?.fontFamilies ?? [];
	const result: SelfHostedFonts = { hosted: [], missing: [], failed: [] };
	const dirs = await themeDirs( themeDir );
	for ( const family of families ) {
		// The font the browser asks for first; the preset's name is only its label.
		const font = family.fontFamily
			?.split( ',' )[ 0 ]
			.trim()
			.replace( /^['"]|['"]$/g, '' );
		const name = family.name ?? font;
		const missing = !! family.fontFace?.length && ( await namesMissingFiles( family, dirs ) );
		if ( ( family.fontFace?.length && ! missing ) || ! font || ! name ) {
			continue;
		}
		const url = `https://fonts.googleapis.com/css2?family=${ font.replace(
			/ /g,
			'+'
		) }:wght@${ weightsOf( themeJson.styles ).join( ';' ) }&display=swap`;
		try {
			family.fontFace = Object.values( await downloadThemeFonts( url, themeDir ) ).flat();
			result.hosted.push( name );
			if ( missing ) {
				result.missing.push( name );
			}
		} catch ( error ) {
			result.failed.push( {
				family: name,
				font,
				error: error instanceof Error ? error.message : String( error ),
			} );
		}
	}
	if ( result.hosted.length ) {
		await writeFile( themeJsonPath, JSON.stringify( themeJson, null, '\t' ) + '\n' );
	}
	return result;
}
