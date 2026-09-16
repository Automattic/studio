import { parse } from 'yaml';

type Style = Record< string, unknown >;

interface DesignTokens {
	colors?: Record< string, unknown >;
	typography?: Record< string, unknown >;
	rounded?: Record< string, unknown >;
	components?: Record< string, unknown >;
	imagery?: { filter?: unknown; overlay?: unknown };
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
		if ( design.trimStart().startsWith( '---' ) ) {
			throw new Error(
				"The DESIGN.md draft's front matter is never closed — end the YAML block with a second --- line before the prose."
			);
		}
		throw new Error(
			'The DESIGN.md draft must start with YAML front matter, opening with a --- line.'
		);
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

	const named = ( key: string ) => colors.find( ( [ name ] ) => name === key )?.[ 1 ];
	const byLuminance = colors
		.map( ( [ , value ] ) => value )
		.sort( ( a, b ) => luminance( a ) - luminance( b ) );
	const background = named( 'background' ) ?? byLuminance[ byLuminance.length - 1 ];
	const text =
		named( 'text' ) ??
		( luminance( background ) > 0.2 ? byLuminance[ 0 ] : byLuminance[ byLuminance.length - 1 ] );
	const primary = named( 'primary' ) ?? colors[ 0 ][ 1 ];
	const hairline = `color-mix(in srgb,${ css( text ) } 18%,transparent)`;
	const ink = ( surface: string ) =>
		Math.abs( luminance( text ) - luminance( surface ) ) >=
		Math.abs( luminance( background ) - luminance( surface ) )
			? text
			: background;
	const seen = new Set< string >();
	const palette = [
		[ 'primary', primary ],
		[ 'background', background ],
		[ 'text', text ],
		...colors,
	].filter(
		( [ , value ] ) => ! seen.has( value.toLowerCase() ) && seen.add( value.toLowerCase() )
	);
	const accents = palette.slice( 3 );
	const tile = ( [ key, value ]: string[] ) =>
		`<div class="tile" style="background-color:${ css( value ) };color:${ css( ink( value ) ) }${
			value === background ? `;box-shadow:inset 0 0 0 1px ${ hairline }` : ''
		}"><span>${ escapeHtml( value ) }</span><span>${ escapeHtml( key ) }</span></div>`;
	const strip = palette
		.filter( ( [ , value ] ) => value !== background )
		.map(
			( [ , value ], index ) =>
				`<i style="background-color:${ css( value ) };flex:${ Math.max( 1, 3 - index ) }"></i>`
		)
		.join( '' );

	const styleNamed = ( name: string ) => styles.find( ( [ key ] ) => key.includes( name ) )?.[ 1 ];
	const display = styleNamed( 'display' ) ?? styles[ 0 ][ 1 ];
	const headline = styleNamed( 'headline' ) ?? display;
	const body = styleNamed( 'body' ) ?? styles[ styles.length - 1 ][ 1 ];
	const label = styleNamed( 'label' ) ?? body;
	const specimen = ( className: string, style: Style ) =>
		`<figure><div class="aa ${ className }">Aa</div><figcaption>${ escapeHtml(
			[ fontFamily( style ), style.fontWeight ].filter( Boolean ).join( ' · ' )
		) }</figcaption></figure>`;

	const resolve = ( value: unknown ): unknown => {
		const reference = typeof value === 'string' ? value.match( /^\{([^}]+)\}$/ )?.[ 1 ] : undefined;
		return reference
			? reference
					.split( '.' )
					.reduce< unknown >( ( node, key ) => ( node as Style | undefined )?.[ key ], tokens )
			: value;
	};
	const rounded = tokens.rounded ?? {};
	const small = dimension( rounded.sm ?? rounded.md ?? 0 );
	const shape =
		Object.values( rounded ).find(
			( value ) => String( value ).trim().split( /\s+/ ).length > 1
		) ??
		rounded.lg ??
		rounded.md ??
		0;
	const button = ( tokens.components?.[ 'button-primary' ] ?? {} ) as Style;
	const buttonBackground = String( resolve( button.backgroundColor ) ?? primary );
	const buttonType = resolve( button.typography );
	const buttonCss = [
		`border-radius:${ dimension( resolve( button.rounded ) ?? 0 ) }`,
		`padding:${ dimension( resolve( button.padding ) ?? '14px 28px' ) }`,
		fontCss( buttonType && typeof buttonType === 'object' ? ( buttonType as Style ) : label ),
	].join( ';' );
	const accent = accents[ 0 ]?.[ 1 ] ?? text;
	const treatment = tokens.imagery ?? {};
	const overlay = [ 'multiply', 'screen' ].find( ( mode ) => mode === treatment.overlay );

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${ fontLinks( styles.map( ( [ , style ] ) => style ) ) }
<style>
*{box-sizing:border-box;margin:0}
body{position:relative;width:1200px;height:900px;overflow:hidden;padding:36px 36px 48px;display:grid;grid-template:392px 1fr/1fr 440px;gap:28px 36px;background:${ css(
		background
	) };color:${ css( text ) };font-size:15px;line-height:1.45;${ fontCss( body ) }}
section{display:flex;flex-direction:column;min-width:0;min-height:0}
h2{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;opacity:.55;padding-top:8px;margin-bottom:16px;border-top:1px solid ${ hairline }}
.specimens{display:flex;align-items:flex-end;gap:32px}
.aa{line-height:.85;white-space:nowrap}
.display{${ fontCss( display ) };font-size:168px}
.reading{${ fontCss( body ) };font-size:84px}
figcaption{margin-top:12px;font-size:13px;opacity:.65}
.scale{margin-top:auto;padding-top:16px}
.scale p{padding:10px 0;border-top:1px solid ${ hairline }}
.headline{${ fontCss( headline ) };font-size:min(${ dimension(
		headline.fontSize ?? '28px'
	) },30px);line-height:1.15}
.sample{font-size:${ dimension( body.fontSize ?? '16px' ) }}
.label{${ fontCss( label ) };font-size:13px}
.palette{flex:1;display:flex;flex-direction:column;gap:4px;min-height:0;border-radius:min(${ small },10px);overflow:hidden}
.lead{flex:2;display:flex;gap:4px;min-height:0}
.lead>.tile{flex:1.15}
.pair{flex:1;display:flex;flex-direction:column;gap:4px}
.accents{flex:1;display:flex;gap:4px}
.pair>.tile,.accents>.tile{flex:1}
.tile{display:flex;flex-direction:column;justify-content:flex-end;padding:12px 14px;font-size:13px;line-height:1.35;min-width:0}
.tile span:first-child{text-transform:uppercase}
.tile span:last-child{text-transform:capitalize;opacity:.8}
.kit{flex:1;display:flex;align-items:flex-start;gap:32px;min-height:0;zoom:1.1}
.stack{display:flex;flex-direction:column;gap:18px;min-width:0}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.button{border:1px solid transparent;${ buttonCss };font-size:15px;line-height:1.2}
.primary{background-color:${ css( buttonBackground ) };color:${ css(
		resolve( button.textColor ) ?? ink( buttonBackground )
	) }${ buttonBackground === 'transparent' ? ';border-color:currentColor' : '' }}
.secondary{border-color:currentColor}
.link{color:${ css( primary ) };text-decoration:underline;text-underline-offset:4px}
.input{width:240px;border:1px solid color-mix(in srgb,${ css(
		text
	) } 35%,transparent);border-radius:${ small };padding:12px 14px;opacity:.75}
.tag{${ fontCss( label ) };font-size:12px;padding:6px 12px;border-radius:${
		rounded.pill !== undefined ? dimension( rounded.pill ) : small
	};background-color:color-mix(in srgb,${ css( primary ) } 16%,${ css( background ) })}
.alt{background-color:${ css( accent ) };color:${ css( ink( accent ) ) }}
.card{min-height:190px;width:220px;flex-shrink:0;background-color:color-mix(in srgb,${ css(
		text
	) } 6%,${ css( background ) });border-radius:min(${ dimension(
		rounded.md ?? rounded.sm ?? 0
	) },24px);padding:18px 20px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.card strong{${ fontCss( headline ) };font-size:20px}
.card u{display:block;height:8px;border-radius:4px;background-color:${ hairline }}
.picture{position:relative;flex:1;overflow:hidden;border-radius:${ dimension(
		shape
	) };background-color:${ css( primary ) };color:${ css( ink( primary ) ) }}
.picture img{width:100%;height:100%;object-fit:cover;display:block;filter:${ css(
		treatment.filter ?? 'none'
	) }}
${
	overlay
		? `.picture img+i{position:absolute;inset:0;background-color:${ css(
				primary
		  ) };mix-blend-mode:${ overlay }}`
		: ''
}
.pattern{background-image:radial-gradient(currentColor 20%,transparent 21%);background-size:32px 32px}
.strip{position:absolute;left:0;right:0;bottom:0;height:12px;display:flex}
</style>
</head>
<body>
<section><h2>Type</h2><div class="specimens">${ specimen( 'display', display ) }${
		fontFamily( display ) !== fontFamily( body ) || display.fontWeight !== body.fontWeight
			? specimen( 'reading', body )
			: ''
	}</div><div class="scale"><p class="headline">Headline in ${ escapeHtml(
		fontFamily( headline )
	) }</p><p class="sample">Body text in ${ escapeHtml(
		fontFamily( body )
	) } sets long reads, captions and forms.</p><p class="label">Label in ${ escapeHtml(
		fontFamily( label )
	) }</p></div></section>
<section><h2>Color</h2><div class="palette"><div class="lead">${ tile(
		palette[ 0 ]
	) }<div class="pair">${ palette.slice( 1, 3 ).map( tile ).join( '' ) }</div></div>${
		accents.length ? `<div class="accents">${ accents.map( tile ).join( '' ) }</div>` : ''
	}</div></section>
<section><h2>Components</h2><div class="kit"><div class="stack"><div class="row"><span class="button primary">Button</span><span class="button secondary">Button</span><span class="link">Link</span></div><div class="row"><span class="input">Input</span></div><div class="row"><span class="tag">Tag</span><span class="tag alt">Tag</span></div></div><div class="card"><span class="tag">Card</span><strong>Card title</strong><u style="width:90%"></u><u style="width:65%"></u></div></div></section>
<section><h2>Imagery</h2><div class="picture${ image ? '' : ' pattern' }">${
		image ? `<img src="${ escapeHtml( image ) }" alt="">${ overlay ? '<i></i>' : '' }` : ''
	}</div></section>
<div class="strip">${ strip }</div>
</body>
</html>`;
}
