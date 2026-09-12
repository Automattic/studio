import { parse } from 'yaml';

type Style = Record< string, unknown >;

interface DesignTokens {
	name?: unknown;
	description?: unknown;
	colors?: Record< string, unknown >;
	typography?: Record< string, unknown >;
	components?: Record< string, unknown >;
}

const escapeHtml = ( value: unknown ) =>
	String( value ).replace( /[&<>"']/g, ( char ) => `&#${ char.charCodeAt( 0 ) };` );

const css = ( value: unknown ) => String( value ).replace( /[<>{};"']/g, '' );

const dimension = ( value: unknown ) =>
	typeof value === 'number' ? `${ value }px` : css( value );

function luminance( color: string ): number {
	const hex = color.trim().match( /^#([0-9a-f]{6}|[0-9a-f]{3})/i )?.[ 1 ];
	if ( ! hex ) {
		return 0.5;
	}
	const full = hex.length === 3 ? [ ...hex ].map( ( digit ) => digit + digit ).join( '' ) : hex;
	const [ r, g, b ] = [ 0, 2, 4 ].map( ( start ) => {
		const channel = parseInt( full.slice( start, start + 2 ), 16 ) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ( ( channel + 0.055 ) / 1.055 ) ** 2.4;
	} );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fontFamily( style: Style ): string {
	return String( style.fontFamily ?? '' )
		.split( ',' )[ 0 ]
		.trim()
		.replace( /^["']|["']$/g, '' );
}

function fontCss( style: Style ): string {
	const family = fontFamily( style );
	return [
		family && `font-family:"${ css( family ) }",sans-serif`,
		style.fontWeight !== undefined && `font-weight:${ css( style.fontWeight ) }`,
		style.letterSpacing !== undefined && `letter-spacing:${ dimension( style.letterSpacing ) }`,
	]
		.filter( Boolean )
		.join( ';' );
}

function fontLinks( styles: Style[] ): string {
	const weights = new Map< string, Set< string > >();
	for ( const style of styles ) {
		const family = fontFamily( style );
		if ( family ) {
			weights.set(
				family,
				( weights.get( family ) ?? new Set< string >() ).add( String( style.fontWeight ?? 400 ) )
			);
		}
	}
	return [ ...weights ]
		.flatMap( ( [ family, familyWeights ] ) => {
			const query = encodeURIComponent( family ).replace( /%20/g, '+' );
			return [ `${ query }:wght@${ [ ...familyWeights ].sort().join( ';' ) }`, query ];
		} )
		.map(
			( query ) =>
				`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${ query }&amp;display=block">`
		)
		.join( '\n' );
}

export function renderDesignBoard( design: string, image?: string ): string {
	const frontMatter = design.trimStart().match( /^---\r?\n([\s\S]*?)\r?\n---/ )?.[ 1 ];
	if ( ! frontMatter ) {
		throw new Error( 'The DESIGN.md draft must start with YAML front matter between --- lines.' );
	}
	const tokens: DesignTokens = parse( frontMatter ) ?? {};
	const colors = Object.entries( tokens.colors ?? {} ).filter(
		( entry ): entry is [ string, string ] => typeof entry[ 1 ] === 'string'
	);
	const styles = Object.entries( tokens.typography ?? {} ).filter(
		( entry ): entry is [ string, Style ] => typeof entry[ 1 ] === 'object' && entry[ 1 ] !== null
	);
	if ( colors.length < 2 || ! styles.length ) {
		throw new Error(
			'The DESIGN.md front matter needs at least two colors, as quoted hex values (primary: "#c2552b"), and one typography style.'
		);
	}

	const values = colors.map( ( [ , value ] ) => value );
	const byLuminance = [ ...values ].sort( ( a, b ) => luminance( a ) - luminance( b ) );
	const dark = byLuminance[ 0 ];
	const light = byLuminance[ byLuminance.length - 1 ];
	const primary = typeof tokens.colors?.primary === 'string' ? tokens.colors.primary : values[ 0 ];
	const ink = ( background: string ) => ( luminance( background ) > 0.2 ? dark : light );
	const styleNamed = ( name: string ) => styles.find( ( [ key ] ) => key.includes( name ) )?.[ 1 ];
	const display = styleNamed( 'display' ) ?? styles[ 0 ][ 1 ];
	const body = styleNamed( 'body' ) ?? styles[ styles.length - 1 ][ 1 ];

	const resolve = ( value: unknown ): unknown => {
		const reference = typeof value === 'string' ? value.match( /^\{([^}]+)\}$/ )?.[ 1 ] : undefined;
		return reference
			? reference
					.split( '.' )
					.reduce< unknown >( ( node, key ) => ( node as Style | undefined )?.[ key ], tokens )
			: value;
	};
	const button = ( tokens.components?.[ 'button-primary' ] ?? {} ) as Style;
	const buttonBackground = String( resolve( button.backgroundColor ) ?? primary );
	const ghost = buttonBackground === 'transparent';
	const buttonType = resolve( button.typography );
	const buttonCss = [
		`background:${ css( buttonBackground ) }`,
		`color:${ css( resolve( button.textColor ) ?? ink( buttonBackground ) ) }`,
		ghost && 'border:1px solid currentColor',
		`border-radius:${ dimension( resolve( button.rounded ) ?? 0 ) }`,
		`padding:${ dimension( resolve( button.padding ) ?? '12px 24px' ) }`,
		fontCss(
			buttonType && typeof buttonType === 'object'
				? ( buttonType as Style )
				: styleNamed( 'label' ) ?? body
		),
	]
		.filter( Boolean )
		.join( ';' );
	const accent =
		values.find( ( value ) => ! [ dark, light, primary, buttonBackground ].includes( value ) ) ??
		dark;

	const name = String( tokens.name ?? 'Untitled' );
	const longestWord = Math.max( ...name.split( /\s+/ ).map( ( word ) => word.length ) );
	const tile = ( background: string, content: string, className = '', color = ink( background ) ) =>
		`<div class="tile ${ className }" style="background-color:${ css( background ) };color:${ css(
			color
		) }">${ content }</div>`;
	const sample = ( background: string ) => {
		const clash =
			! ghost && Math.abs( luminance( buttonBackground ) - luminance( background ) ) < 0.1;
		const inverted = clash
			? ` style="background:${ css( ink( background ) ) };color:${ css( background ) }"`
			: '';
		return `<div class="display heading">${ escapeHtml(
			tokens.description ?? name
		) }</div><div class="actions"><span class="button"${ inverted }>Get started</span><span class="link">Learn more</span></div>`;
	};
	const swatches = colors
		.map(
			( [ key, value ] ) =>
				`<div class="swatch" style="background-color:${ css( value ) };color:${ css(
					ink( value )
				) }"><i></i><span>${ escapeHtml( key ) } ${ escapeHtml( value ) }</span></div>`
		)
		.join( '' );
	const families = [
		...new Set( [ fontFamily( display ), fontFamily( body ) ].filter( Boolean ) ),
	];

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${ fontLinks( styles.map( ( [ , style ] ) => style ) ) }
<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:900px;padding:12px;display:grid;grid-template:1fr 1fr/repeat(3,1fr);gap:12px;background:#e6e4df;font-size:15px;line-height:1.5;${ fontCss(
		body
	) }}
.tile{overflow:hidden;padding:36px;display:flex;flex-direction:column;justify-content:flex-end;gap:16px}
.swatches{padding:0;gap:0;flex-flow:row wrap}
.swatch{position:relative;display:grid;place-items:center;flex:1 0 ${
		colors.length > 4 ? 30 : 40
	}%}
.swatch i{width:44px;height:44px;border-radius:50%;background:currentColor}
.swatch span{position:absolute;left:12px;bottom:10px;font-size:12px}
.display{line-height:1;${ fontCss( display ) }}
.aa{font-size:200px;line-height:.85}
.heading{font-size:32px;line-height:1.1}
.actions{display:flex;gap:20px;align-items:center}
.button{${ buttonCss }}
.link{text-decoration:underline;text-underline-offset:4px}
.wordmark{justify-content:center;text-align:center;overflow-wrap:anywhere}
.picture{padding:0}
.picture img{width:100%;height:100%;object-fit:cover}
.pattern{background-image:radial-gradient(currentColor 20%,transparent 21%);background-size:40px 40px}
</style>
</head>
<body>
<div class="tile swatches">${ swatches }</div>
${ tile(
	dark,
	`<div class="display aa">Aa</div><p>${ escapeHtml( families.join( ' · ' ) ) }</p>`
) }
${
	image
		? tile( primary, `<img src="${ escapeHtml( image ) }" alt="">`, 'picture' )
		: tile( primary, '', 'picture pattern', accent )
}
${ tile( light, sample( light ) ) }
${ tile(
	primary,
	`<div class="display" style="font-size:${ Math.round(
		Math.min( 84, Math.max( 28, 440 / longestWord ) )
	) }px">${ escapeHtml( name ) }</div>`,
	'wordmark'
) }
${ tile( accent, sample( accent ) ) }
</body>
</html>`;
}
