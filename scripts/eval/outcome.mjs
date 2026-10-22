// Outcome assertions for the Studio Code agent eval.
//
// Each check judges what the turn left behind — the site's WordPress state,
// its rendered home page, its theme files, and what the user was told — not
// which tools the agent called. The one exception is `skillsLoadedFirst`, for
// routing cases: which runbooks the agent read before starting the work. The runner captures that state after the turn
// (apps/cli/ai/eval-outcome.ts) into the result's `outcome` field.
//
// Use from promptfoo.config.yaml as `type: javascript` with
// `value: file://outcome.mjs:<check>`; per-case parameters come from `vars`.
import { readFileSync } from 'node:fs';

const MARKER = /EVAL_RUNNER_RESULT_FILE=(\S+)/;

function load( output ) {
	const marker = String( output ).match( MARKER );
	if ( ! marker )
		throw new Error( `no runner result in output: ${ String( output ).slice( 0, 300 ) }` );
	return JSON.parse( readFileSync( marker[ 1 ], 'utf8' ) );
}

const pass = ( reason ) => ( { pass: true, score: 1, reason } );
const fail = ( reason ) => ( { pass: false, score: 0, reason } );

// Runs a check against the loaded result, turning a thrown problem into a failure.
function check( fn ) {
	return ( output, context ) => {
		try {
			return fn( load( output ), context?.vars ?? {} );
		} catch ( error ) {
			return fail( error instanceof Error ? error.message : String( error ) );
		}
	};
}

const reply = ( d ) => ( d.textSegments || [] ).join( '\n' );
const finalReply = ( d ) => ( d.textSegments || [] ).at( -1 ) || '';
const asksUser = ( text ) =>
	/\?|let me know|please (give|provide|share|confirm|tell)|which (one )?(do|would) you/i.test(
		text
	);

// The site a case is about: the one the turn created with `vars.siteName`,
// otherwise the seeded active site.
function site( d, vars ) {
	const sites = d.outcome?.sites || [];
	const found = vars.siteName
		? sites.find( ( s ) => s.name === vars.siteName )
		: sites.find( ( s ) => ! s.created ) || sites[ 0 ];
	if ( ! found ) {
		throw new Error(
			`no site${
				vars.siteName ? ` named "${ vars.siteName }"` : ''
			} after the turn; sites: ${ JSON.stringify( sites.map( ( s ) => s.name ) ) }${
				d.outcome?.error ? `; capture error: ${ d.outcome.error }` : ''
			}`
		);
	}
	if ( found.error ) throw new Error( `could not inspect "${ found.name }": ${ found.error }` );
	return found;
}

const frontPage = ( s ) => ( s.content || [] ).find( ( c ) => c.isFront );

// Everything a site's look is made of: front page and template/part content,
// theme stylesheets and theme.json, custom CSS.
function siteDesignText( s, { includeThemeJson = true } = {} ) {
	const content = ( s.content || [] )
		.filter( ( c ) => [ 'page', 'wp_template', 'wp_template_part', 'wp_block' ].includes( c.type ) )
		.map( ( c ) => c.content );
	const files = Object.entries( s.themeFiles || {} )
		.filter( ( [ file ] ) => includeThemeJson || ! file.endsWith( '.json' ) )
		.filter( ( [ file ] ) => ! /(^|\/)package(-lock)?\.json$/.test( file ) )
		.map( ( [ , text ] ) => text );
	return [ ...content, ...files, s.customCss || '' ].join( '\n' );
}

// Every stylesheet that reaches the page, each on its own (in a blob joined
// with block markup, the first rule's selector would start with the markup
// before it), in roughly the order they load, comments stripped: theme `.css`
// files, `css` in theme.json files and saved Global Styles, `<style>` blocks
// in content, and custom CSS.
function stylesheets( s ) {
	const all = siteDesignText( s );
	const jsonCss = [
		...Object.entries( s.themeFiles || {} )
			.filter( ( [ file ] ) => file.endsWith( '.json' ) )
			.map( ( [ , text ] ) => text ),
		JSON.stringify( s.userGlobalStyles ?? {} ),
	].join( '\n' );
	const sheets = [
		...Object.entries( s.themeFiles || {} )
			.filter( ( [ file ] ) => file.endsWith( '.css' ) )
			.map( ( [ file, css ] ) => ( { source: file, css } ) ),
		...[ ...jsonCss.matchAll( /"css"\s*:\s*"((?:[^"\\]|\\.)*)"/g ) ].map( ( m ) => ( {
			source: 'theme.json css',
			css: JSON.parse( `"${ m[ 1 ] }"` ),
		} ) ),
		...[ ...all.matchAll( /<style[^>]*>([\s\S]*?)<\/style>/g ) ].map( ( m ) => ( {
			source: '<style>',
			css: m[ 1 ],
		} ) ),
		{ source: 'custom CSS', css: s.customCss || '' },
	];
	return sheets.map( ( sheet ) => ( {
		...sheet,
		css: sheet.css.replace( /\/\*[\s\S]*?\*\//g, ' ' ),
	} ) );
}

// Each rule of a stylesheet, innermost first for rules nested in at-rules:
// its selectors (whitespace collapsed) and declaration block.
function cssRules( css ) {
	return [ ...css.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ].map( ( m ) => ( {
		selectors: m[ 1 ]
			.split( ',' )
			.map( ( sel ) => sel.trim().replace( /\s+/g, ' ' ) )
			.filter( Boolean ),
		body: m[ 2 ],
	} ) );
}

// The code files the turn added or changed on the active site.
function codeChanges( s ) {
	if ( ! Array.isArray( s.codeChanges ) )
		throw new Error( `no record of the code the turn changed on "${ s.name }"` );
	return s.codeChanges.filter( ( c ) => c.status !== 'removed' );
}

// Block markup with each `wp:pattern` and synced pattern (`wp:block`) it
// references replaced by that pattern's content, a few levels deep.
function expandPatterns( s, text, depth = 3 ) {
	if ( depth <= 0 ) return text;
	const patterns = Object.entries( s.themeFiles || {} )
		.filter( ( [ file ] ) => /^patterns\/.+\.php$/.test( file ) )
		.map( ( [ , src ] ) => [ src.match( /^[\s*]*Slug:\s*(\S+)/m )?.[ 1 ], src ] );
	return text
		.replace( /<!-- wp:pattern (\{.*?\}) \/-->/g, ( whole, attrs ) => {
			const slug = attrs.match( /"slug"\s*:\s*"([^"]+)"/ )?.[ 1 ];
			const file = patterns.find( ( [ patternSlug ] ) => slug && patternSlug === slug );
			return file ? expandPatterns( s, file[ 1 ], depth - 1 ) : whole;
		} )
		.replace( /<!-- wp:block (\{.*?\}) \/-->/g, ( whole, attrs ) => {
			const ref = Number( attrs.match( /"ref"\s*:\s*(\d+)/ )?.[ 1 ] );
			const block = ( s.content || [] ).find( ( c ) => c.type === 'wp_block' && c.id === ref );
			return block ? expandPatterns( s, block.content, depth - 1 ) : whole;
		} );
}

// The template part WordPress renders for each slug: the copy saved in the
// Site Editor, otherwise the theme's file, with its patterns expanded.
function renderedParts( s ) {
	const parts = {};
	for ( const [ file, text ] of Object.entries( s.themeFiles || {} ) ) {
		const slug = file.match( /^parts\/(.+)\.html$/ )?.[ 1 ];
		if ( slug ) parts[ slug ] = text;
	}
	for ( const c of s.content || [] ) {
		if ( c.type === 'wp_template_part' ) parts[ c.slug ] = c.content;
	}
	return Object.fromEntries(
		Object.entries( parts ).map( ( [ slug, text ] ) => [ slug, expandPatterns( s, text ) ] )
	);
}

// The markup the home page is built from: the static front page's content,
// otherwise the front-page or home template (saved or theme file).
function frontMarkup( s ) {
	const front = frontPage( s );
	if ( s.showOnFront === 'page' && front )
		return { source: `page "${ front.title }"`, text: expandPatterns( s, front.content ) };
	for ( const slug of [ 'front-page', 'home', 'index' ] ) {
		const saved = ( s.content || [] ).find( ( c ) => c.type === 'wp_template' && c.slug === slug );
		const text = saved?.content ?? s.themeFiles?.[ `templates/${ slug }.html` ];
		if ( text !== undefined )
			return {
				source: `${ saved ? 'saved' : 'theme' } ${ slug } template`,
				text: expandPatterns( s, text ),
			};
	}
	return { source: 'nothing', text: '' };
}

const countBlocks = ( text, name ) =>
	( text.match( new RegExp( `<!-- wp:${ name }(?=[\\s/])`, 'g' ) ) || [] ).length;

// A preset reference (`var:preset|<kind>|slug` or `var(--wp--preset--<kind>--slug)`) resolved
// against the site's presets, or the value as is.
function resolvePreset( value, kind, presets, field ) {
	const slug = String( value ?? '' ).match(
		new RegExp(
			`^(?:var:preset\\|${ kind }\\|([\\w-]+)|var\\(\\s*--wp--preset--${ kind }--([\\w-]+)\\s*\\))$`
		)
	);
	if ( ! slug ) return value;
	const found = ( presets || [] ).find( ( p ) => p.slug === ( slug[ 1 ] ?? slug[ 2 ] ) );
	return found ? found[ field ] : value;
}

// [r, g, b] of a hex or rgb() color, or null.
function rgb( color ) {
	const c = String( color ?? '' )
		.trim()
		.toLowerCase();
	const hex = c.match( /^#([0-9a-f]{3}|[0-9a-f]{6})$/ );
	if ( hex ) {
		const h = hex[ 1 ].length === 3 ? [ ...hex[ 1 ] ].map( ( x ) => x + x ).join( '' ) : hex[ 1 ];
		return [ 0, 2, 4 ].map( ( i ) => parseInt( h.slice( i, i + 2 ), 16 ) );
	}
	const fn = c.match( /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/ );
	return fn ? fn.slice( 1, 4 ).map( Number ) : null;
}

// --- Shared outcome checks ---------------------------------------------------

// The site the case is about exists, renders, and every published page,
// template and part is valid in the site's own block editor.
export const siteWorks = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( s.home?.status !== 200 )
		return fail( `home page returned ${ s.home?.status } ${ s.home?.error || '' }` );
	if ( s.home.phpErrors?.length )
		return fail( `home page shows PHP errors: ${ s.home.phpErrors.join( ' | ' ) }` );
	if ( s.invalidBlocks?.length ) {
		return fail(
			`invalid blocks the editor would flag: ${ s.invalidBlocks
				.map( ( i ) => `${ i.type } ${ i.slug }: ${ i.blocks.join( ', ' ) }` )
				.join( '; ' ) }`
		);
	}
	return pass( `"${ s.name }" renders at ${ s.url } with valid blocks` );
} );

// No other site the user has was changed or removed.
export const otherSitesUntouched = check( ( d ) => {
	const o = d.outcome;
	if ( ! o || o.error ) return fail( `no outcome captured: ${ o?.error }` );
	const touched = [
		...o.otherSitesChanged.map( ( n ) => `changed "${ n }"` ),
		...o.otherSitesRemoved.map( ( n ) => `removed "${ n }"` ),
	];
	return touched.length
		? fail( `touched other sites: ${ touched.join( ', ' ) }` )
		: pass( 'no other site was changed' );
} );

// The turn created no site, and (with vars.requestSiteUnchanged) left the active site as it was.
export const noSiteCreated = check( ( d, vars ) => {
	const created = ( d.outcome?.sites || [] ).filter( ( s ) => s.created );
	if ( created.length )
		return fail( `created ${ created.map( ( s ) => `"${ s.name }"` ).join( ', ' ) }` );
	if ( vars.requestSiteUnchanged && d.outcome?.requestSiteChanged )
		return fail( 'the active site was changed' );
	return pass( 'no site was created' );
} );

// No turn took longer than vars.maxTurnMs (default 60s), so the UI never stalls.
export const turnsAreResponsive = check( ( d, vars ) => {
	const limit = vars.maxTurnMs ?? 60000;
	const durations = d.turnDurationsMs ?? [];
	if ( ! durations.length ) return fail( 'no turns recorded' );
	const max = Math.max( ...durations );
	return max < limit
		? pass( `longest turn ${ max }ms across ${ durations.length }` )
		: fail(
				`turn ${ durations.indexOf( max ) + 1 }/${
					durations.length
				} took ${ max }ms (limit ${ limit }ms)`
		  );
} );

// The case reached its outcome within its budget: at most vars.maxToolCalls
// tool calls and vars.maxTokens tokens, summed over all its turns. A run that gets the
// right result by looping through dozens of calls costs the user credits, so a
// pass that blows the budget counts as a regression.
export const withinBudget = check( ( d, vars ) => {
	if ( vars.maxToolCalls === undefined && vars.maxTokens === undefined )
		throw new Error( 'the case sets neither maxToolCalls nor maxTokens' );
	const calls = ( d.toolCalls || [] ).length;
	const tokens = d.usage?.totalTokens ?? 0;
	const over = [];
	if ( vars.maxToolCalls !== undefined && calls > vars.maxToolCalls )
		over.push( `${ calls } tool calls (limit ${ vars.maxToolCalls })` );
	if ( vars.maxTokens !== undefined && tokens > vars.maxTokens )
		over.push( `${ tokens } tokens (limit ${ vars.maxTokens })` );
	return over.length
		? fail( `over budget: ${ over.join( ', ' ) }` )
		: pass( `${ calls } tool calls, ${ tokens } tokens` );
} );

// --- Reply checks ---------------------------------------------------------

export const identifiesAsStudio = check( ( d ) => {
	const text = reply( d );
	const other =
		/\bI\s+am\s+(Claude|ChatGPT|a large language model|an AI (model|assistant) (made|built|developed) by Anthropic)\b/i.test(
			text
		);
	return /WordPress\s+Studio/i.test( text ) && ! other
		? pass( 'identifies as WordPress Studio' )
		: fail( `got: ${ text.slice( 0, 300 ) }` );
} );

export const replyIncludes = check( ( d, vars ) =>
	reply( d ).includes( vars.expectedText )
		? pass( `reply includes ${ vars.expectedText }` )
		: fail( `reply lacks ${ vars.expectedText }: ${ reply( d ).slice( 0, 300 ) }` )
);

// Desktop and mobile captures reached the model, quickly. Read from the images
// the screenshot tool returned, however many calls it took.
export const sawDesktopAndMobile = check( ( d, vars ) => {
	const size = ( data ) => {
		const buf = Buffer.from( data, 'base64' );
		if ( buf.length > 24 && buf.readUInt32BE( 0 ) === 0x89504e47 )
			return { width: buf.readUInt32BE( 16 ), height: buf.readUInt32BE( 20 ) };
		for ( let offset = 2; buf[ 0 ] === 0xff && offset + 9 < buf.length;  ) {
			if ( buf[ offset ] !== 0xff ) {
				offset++;
				continue;
			}
			const marker = buf[ offset + 1 ];
			if (
				marker === 0xd8 ||
				marker === 0xd9 ||
				( marker >= 0xd0 && marker <= 0xd7 ) ||
				marker === 0x01
			) {
				offset += 2;
				continue;
			}
			if ( marker >= 0xc0 && marker <= 0xcf && ! [ 0xc4, 0xc8, 0xcc ].includes( marker ) ) {
				return { height: buf.readUInt16BE( offset + 5 ), width: buf.readUInt16BE( offset + 7 ) };
			}
			offset += 2 + buf.readUInt16BE( offset + 2 );
		}
		return null;
	};
	const shots = ( d.toolResults || [] ).filter(
		( r ) => r.toolName === 'take_screenshot' && ! r.isError
	);
	const sizes = shots
		.flatMap( ( r ) => ( r.images || [] ).map( ( i ) => size( i.data ) ) )
		.filter( Boolean );
	const desktop = sizes.find( ( s ) => s.width >= 1000 );
	const mobile = sizes.find( ( s ) => s.width < 600 && s.height >= 600 );
	if ( ! desktop || ! mobile )
		return fail(
			`the model did not see both a desktop and a mobile capture: ${ JSON.stringify( sizes ) }`
		);
	const limit = vars.maxScreenshotMs ?? 15000;
	const spent = ( d.toolEvents || [] )
		.filter( ( e ) => e.toolName === 'take_screenshot' )
		.reduce( ( t, e ) => t + ( e.durationMs || 0 ), 0 );
	if ( spent >= limit )
		return fail( `screenshots took ${ spent }ms in total (limit ${ limit }ms)` );
	return pass(
		`desktop ${ desktop.width }px and mobile ${ mobile.width }px captures seen in ${ spent }ms`
	);
} );

// The reply names each related site with the right kind: the preview as a
// temporary preview, the connected site as a WordPress.com remote site.
export const classifiesPreviewAndRemote = check( ( d ) => {
	const lines = reply( d ).split( /\r?\n/ );
	const about = ( needle ) =>
		lines.filter( ( l ) => l.toLowerCase().includes( needle ) ).join( ' ' );
	const preview = about( 'abc123-studio.wp.build' );
	const remote = about( 'myprod.wordpress.com' ) || about( 'my production site' );
	if ( ! preview || ! /preview|temporary/i.test( preview ) )
		return fail(
			`the preview site is not described as a preview: ${ preview || '(not mentioned)' }`
		);
	if (
		! remote ||
		/preview|temporary/i.test( remote ) ||
		! /connected|remote|wordpress\.com|production/i.test( remote )
	) {
		return fail(
			`the connected site is not described as a WordPress.com remote site: ${
				remote || '(not mentioned)'
			}`
		);
	}
	return pass( 'preview and connected remote site described as different kinds' );
} );

// Nothing reached WordPress.com, and the agent asked the user: with a question
// (the case's scripted answer declines it) or in its final reply.
export const pushNotRunAndAsks = check( ( d ) => {
	const pushed = ( d.toolResults || [] ).find( ( r ) => r.toolName === 'site_push' && ! r.isError );
	if ( pushed ) return fail( `a push ran: ${ ( pushed.text || '' ).slice( 0, 300 ) }` );
	const asked = d.questions?.[ 0 ];
	if ( asked ) return pass( `nothing pushed; asked "${ asked.question }"` );
	return asksUser( finalReply( d ) )
		? pass( 'nothing pushed; the reply asks the user' )
		: fail( `the agent did not ask the user: ${ finalReply( d ).slice( 0, 300 ) }` );
} );

// No site was created or changed, and the reply asks whether to use the active site or make a new one.
export const asksCurrentOrNew = check( ( d ) => {
	const created = ( d.outcome?.sites || [] ).filter( ( s ) => s.created );
	if ( created.length ) return fail( `created "${ created[ 0 ].name }" without asking` );
	if ( d.outcome?.requestSiteChanged ) return fail( 'changed the active site without asking' );
	const text = reply( d );
	const offers =
		/(current|existing|active)\s+site|Eval Active Site/i.test( text ) &&
		/\b(new|separate|another|second)\b/i.test( text );
	return offers && asksUser( text )
		? pass( 'asked: active site or a new one' )
		: fail( `no current-or-new question: ${ text.slice( 0, 300 ) }` );
} );

// --- Site outcome checks -------------------------------------------------------

// A static front page with block content, and the active theme looks the way DESIGN.md says.
export const builtFromDesign = check( ( d, vars ) => {
	const s = site( d, vars );
	const front = frontPage( s );
	if ( s.showOnFront !== 'page' || ! front )
		return fail( `no static front page (show_on_front=${ s.showOnFront })` );
	if ( Object.keys( front.blocks ).length < 2 )
		return fail( `the front page has almost no blocks: ${ JSON.stringify( front.blocks ) }` );
	if ( ! s.designMd ) return fail( 'no DESIGN.md at the site root' );
	const designColors = [ ...s.designMd.matchAll( /#[0-9a-f]{6}\b/gi ) ].map( ( m ) =>
		m[ 0 ].toLowerCase()
	);
	const palette = new Set( ( s.palette || [] ).map( ( p ) => String( p.color ).toLowerCase() ) );
	const followed = designColors.filter( ( c ) => palette.has( c ) );
	if ( designColors.length && ! followed.length )
		return fail(
			`none of DESIGN.md's colors are in the theme palette: ${ designColors.join( ', ' ) }`
		);
	return pass(
		`front page "${ front.title }" built; ${ followed.length }/${ designColors.length } DESIGN.md colors in the palette`
	);
} );

// The active theme is a new theme, with self-hosted fonts and a real screenshot.
export const ownThemeWithFontsAndScreenshot = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( /^twentytwenty/.test( s.theme.stylesheet ) )
		return fail( `the site still runs ${ s.theme.stylesheet }` );
	const themeJson = s.themeFiles?.[ 'theme.json' ] || '';
	const fontSources = [ ...themeJson.matchAll( /"file:\.\/([^"]+)"/g ) ].map( ( m ) => m[ 1 ] );
	const missing = fontSources.filter( ( f ) => ! s.themeFileList.includes( f ) );
	if ( ! fontSources.length ) return fail( 'theme.json loads no self-hosted fonts' );
	if ( missing.length )
		return fail( `theme.json fonts missing from the theme: ${ missing.join( ', ' ) }` );
	if ( ! s.themeScreenshot?.startsWith( 'jpeg:' ) && ! s.themeScreenshot?.startsWith( 'png:' ) ) {
		return fail( `theme screenshot is ${ s.themeScreenshot ?? 'missing' }` );
	}
	return pass(
		`theme ${ s.theme.stylesheet }: ${ fontSources.length } self-hosted font file(s), screenshot ${ s.themeScreenshot }`
	);
} );

// Section links in the rendered navigation work from every page: they point
// at the home page ("/#id" or a full URL), and each target exists on it.
export const navAnchorsWorkEverywhere = check( ( d, vars ) => {
	const s = site( d, vars );
	const anchors = ( s.home?.navHrefs || [] ).filter( ( h ) => /#./.test( h ) );
	if ( anchors.length < 2 )
		return fail(
			`the navigation has ${ anchors.length } section link(s): ${ JSON.stringify(
				s.home?.navHrefs
			) }`
		);
	const bare = anchors.filter( ( h ) => h.startsWith( '#' ) );
	if ( bare.length )
		return fail( `${ bare.length } link(s) only work on the home page: ${ bare.join( ', ' ) }` );
	const ids = new Set( s.home.ids );
	const dangling = anchors.filter(
		( h ) => ! ids.has( decodeURIComponent( h.split( '#' )[ 1 ] ) )
	);
	if ( dangling.length )
		return fail( `links to sections the home page does not have: ${ dangling.join( ', ' ) }` );
	return pass(
		`${ anchors.length } section links, all home-relative with targets: ${ anchors.join( ', ' ) }`
	);
} );

// The listed plugins are active and the front page uses a block from one of them.
export const pluginBlockOnFrontPage = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( ! s.plugins.includes( vars.plugin ) )
		return fail( `${ vars.plugin } is not active: ${ JSON.stringify( s.plugins ) }` );
	const front = frontPage( s );
	const used = Object.keys( front?.blocks || {} ).filter( ( b ) =>
		b.startsWith( vars.blockPrefix )
	);
	return used.length
		? pass( `front page uses ${ used.join( ', ' ) }` )
		: fail(
				`no ${ vars.blockPrefix }* block on the front page: ${ JSON.stringify( front?.blocks ) }`
		  );
} );

export const storeHasProducts = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( ! s.plugins.includes( 'woocommerce' ) )
		return fail( `WooCommerce is not active: ${ JSON.stringify( s.plugins ) }` );
	return s.products > 0
		? pass( `${ s.products } published product(s)` )
		: fail( 'no published products' );
} );

// The design lives in a child theme of vars.parentTheme, the parent is still
// its WordPress.org release, and headings use a serif face.
export const customizedThroughChildTheme = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( s.theme.template !== vars.parentTheme || s.theme.stylesheet === vars.parentTheme ) {
		return fail(
			`active theme is ${ s.theme.stylesheet } (template ${ s.theme.template }), not a child of ${ vars.parentTheme }`
		);
	}
	if ( s.parentThemeChanges === null || s.parentThemeChanges === undefined )
		return fail( `could not compare ${ vars.parentTheme } with its release` );
	if ( s.parentThemeChanges.length )
		return fail(
			`${ vars.parentTheme } differs from its release: ${ s.parentThemeChanges
				.slice( 0, 5 )
				.join( ', ' ) }`
		);
	const heading =
		JSON.stringify( s.mergedStyles?.elements?.heading ?? {} ) +
		JSON.stringify( s.userGlobalStyles?.styles?.elements?.heading ?? {} );
	if ( ! /fontFamily/.test( heading ) )
		return fail( 'no heading font family in the merged styles' );
	return pass(
		`child theme ${ s.theme.stylesheet }; ${ vars.parentTheme } untouched; heading font ${
			heading.match( /"fontFamily":"([^"]+)"/ )?.[ 1 ]
		}`
	);
} );

// The site kept its theme, and the front page's colors come from the palette.
export const colorsFromPalette = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( vars.theme && s.theme.stylesheet !== vars.theme )
		return fail( `theme changed to ${ s.theme.stylesheet }` );
	// What the turn added: published pages, templates and parts, custom CSS,
	// and theme files changed from the release (theme.json defines the palette).
	const changedFiles = ( s.themeChanges || [] ).filter( ( f ) => ! f.endsWith( '.json' ) );
	const text = [
		...( s.content || [] )
			.filter( ( c ) => [ 'page', 'wp_template', 'wp_template_part' ].includes( c.type ) )
			.map( ( c ) => c.content ),
		...changedFiles.map( ( f ) => s.themeFiles?.[ f ] || '' ),
		s.customCss || '',
	].join( '\n' );
	const hex = [
		...new Set( text.match( /(?<![&\w])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g ) || [] ),
	];
	const refs = (
		text.match(
			/"(?:backgroundColor|textColor|borderColor|overlayColor|gradient)"\s*:\s*"[a-z][a-z0-9-]*"|var\(\s*--wp--preset--color--[a-z0-9-]+/g
		) || []
	).length;
	if ( hex.length ) return fail( `the page hardcodes ${ hex.slice( 0, 8 ).join( ', ' ) }` );
	if ( ! refs ) return fail( 'the page uses no palette colors' );
	return pass( `${ refs } palette color reference(s), no hardcoded colors` );
} );

// No rule gives a block wrapper an inline-level display, which escapes the
// constrained layout's centering.
export const noInlineDisplayOnBlockWrappers = check( ( d, vars ) => {
	const s = site( d, vars );
	const all = siteDesignText( s );
	const blockClasses = new Set(
		[ ...all.matchAll( /"className"\s*:\s*"([^"]+)"/g ) ]
			.flatMap( ( m ) => m[ 1 ].split( /\s+/ ) )
			.filter( Boolean )
	);
	const offenders = [];
	for ( const { css } of stylesheets( s ) ) {
		for ( const m of css.matchAll(
			/([^{}]+)\{([^{}]*display\s*:\s*inline(?:-block|-flex|-grid|-table)?(?![\w-])[^{}]*)\}/g
		) ) {
			for ( const selector of m[ 1 ].split( ',' ) ) {
				const bare = selector.trim().match( /^\.([A-Za-z0-9_-]+)$/ );
				if ( bare && blockClasses.has( bare[ 1 ] ) ) offenders.push( `.${ bare[ 1 ] }` );
			}
		}
	}
	return offenders.length
		? fail( `block wrappers with an inline display: ${ offenders.join( ', ' ) }` )
		: pass( `${ blockClasses.size } block classes, none displayed inline` );
} );

// A registered block style variation is applied to the repeated cards, and
// repeated font sizes come from presets.
export const repeatedTreatmentIsBlockStyle = check( ( d, vars ) => {
	const s = site( d, vars );
	const core = new Set( [
		'default',
		'fill',
		'outline',
		'rounded',
		'plain',
		'pill-shape',
		'large',
		'checkmark-list',
		'squared',
		'regular',
		'stripes',
		'logos-only',
		'section-1',
		'section-2',
		'section-3',
		'section-4',
		'section-5',
	] );
	const registered = new Set(
		Object.values( s.blockStyles || {} )
			.flat()
			.filter( ( slug ) => ! core.has( slug ) )
	);
	const content = siteDesignText( s, { includeThemeJson: false } );
	const applied = ( content.match( /is-style-[a-z0-9-]+/g ) || [] )
		.map( ( c ) => c.slice( 9 ) )
		.filter( ( slug ) => registered.has( slug ) );
	if ( applied.length < 2 )
		return fail(
			`registered variations ${ JSON.stringify( [ ...registered ] ) } applied ${
				applied.length
			} time(s)`
		);
	const sizes = {};
	for ( const raw of content.match( /"fontSize"\s*:\s*"\d[^"]*"/g ) || [] )
		sizes[ raw ] = ( sizes[ raw ] || 0 ) + 1;
	const repeated = Object.entries( sizes ).filter( ( [ , n ] ) => n >= 3 );
	if ( repeated.length )
		return fail(
			`raw font sizes repeated instead of presets: ${ repeated
				.map( ( [ k, n ] ) => `${ k } x${ n }` )
				.join( ', ' ) }`
		);
	return pass( `variation "${ applied[ 0 ] }" applied ${ applied.length } times` );
} );

// DESIGN.md's token changed and the active theme's palette carries the new value.
export const designTokenReachedTheme = check( ( d, vars ) => {
	const s = site( d, vars );
	const value = s.designMd
		?.match( new RegExp( `${ vars.token }:\\s*"?(#[0-9a-fA-F]{3,8})` ) )?.[ 1 ]
		?.toLowerCase();
	if ( ! value || value === vars.originalValue.toLowerCase() )
		return fail( `DESIGN.md ${ vars.token } is ${ value ?? 'missing' }` );
	const inPalette = ( s.palette || [] ).some( ( p ) => String( p.color ).toLowerCase() === value );
	return inPalette
		? pass( `DESIGN.md ${ vars.token } is ${ value }, and the theme palette has it` )
		: fail( `DESIGN.md ${ vars.token } is ${ value }, but the theme palette does not have it` );
} );

// --- Native WordPress features over custom code ------------------------------

// The header WordPress renders carries WooCommerce's Mini-Cart block, and the
// turn added no cart-count code of its own to themes or plugins.
export const miniCartInHeader = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( ! ( s.plugins || [] ).includes( 'woocommerce' ) )
		return fail( `WooCommerce is not active: ${ JSON.stringify( s.plugins ) }` );
	const custom = codeChanges( s ).filter(
		( c ) =>
			/\.(php|m?js|jsx|tsx?)$/.test( c.file ) &&
			! c.file.startsWith( 'plugins/woocommerce/' ) &&
			/woocommerce_add_to_cart_fragments|add_to_cart_fragments|get_cart_contents_count|cart_contents_count|wc_cart_fragments|wc-cart-fragments|added_to_cart|wc_fragments/.test(
				c.text || ''
			)
	);
	if ( custom.length )
		return fail( `custom cart-count code added: ${ custom.map( ( c ) => c.file ).join( ', ' ) }` );
	const headers = Object.entries( renderedParts( s ) ).filter( ( [ slug ] ) =>
		/header/.test( slug )
	);
	const withCart = headers.filter( ( [ , text ] ) => countBlocks( text, 'woocommerce/mini-cart' ) );
	return withCart.length
		? pass(
				`header part ${ withCart
					.map( ( [ slug ] ) => `"${ slug }"` )
					.join( ', ' ) } has the Mini-Cart block`
		  )
		: fail(
				`no woocommerce/mini-cart block in the header parts ${ JSON.stringify(
					headers.map( ( [ slug ] ) => slug )
				) }`
		  );
} );

// The home page has at least three Details (or Accordion item) blocks, no
// Custom HTML block or inline script, and the turn added no JavaScript file.
export const faqUsesDetailsBlocks = check( ( d, vars ) => {
	const s = site( d, vars );
	const { source, text } = frontMarkup( s );
	const items = countBlocks( text, 'details' ) + countBlocks( text, 'accordion-item' );
	if ( items < 3 )
		return fail( `${ source } has ${ items } Details/Accordion item block(s), not three` );
	if ( countBlocks( text, 'html' ) ) return fail( `${ source } has a Custom HTML block` );
	if ( /<script\b/i.test( text ) ) return fail( `${ source } has an inline script` );
	const scripts = codeChanges( s ).filter( ( c ) => /\.(m?js|jsx|tsx?)$/.test( c.file ) );
	if ( scripts.length )
		return fail( `JavaScript added: ${ scripts.map( ( c ) => c.file ).join( ', ' ) }` );
	return pass(
		`${ source } has ${ items } Details/Accordion item blocks and no custom HTML or JS`
	);
} );

// A published About page built from native blocks (heading, paragraph, image),
// with no Custom HTML block, and no theme template of raw HTML from the turn.
export const pageInNativeBlocks = check( ( d, vars ) => {
	const s = site( d, vars );
	const title = new RegExp( vars.pageTitle ?? 'about', 'i' );
	const page = ( s.content || [] ).find( ( c ) => c.type === 'page' && title.test( c.title ) );
	if ( ! page ) return fail( `no published page titled like ${ title }` );
	const blocks = page.blocks || {};
	if ( blocks[ 'core/html' ] ) return fail( `"${ page.title }" has a Custom HTML block` );
	const missing = [
		[ 'heading', [ 'core/heading' ] ],
		[ 'paragraph', [ 'core/paragraph' ] ],
		[ 'image', [ 'core/image', 'core/cover', 'core/media-text' ] ],
	].filter( ( [ , names ] ) => ! names.some( ( n ) => blocks[ n ] ) );
	if ( missing.length )
		return fail(
			`"${ page.title }" has no ${ missing
				.map( ( [ k ] ) => k )
				.join( ', ' ) } block: ${ JSON.stringify( blocks ) }`
		);
	const rawHtml = ( text ) =>
		countBlocks( text, 'html' ) > 0 || ( ! text.includes( '<!-- wp:' ) && /<[a-z]/i.test( text ) );
	const templates = [
		...codeChanges( s )
			.filter(
				( c ) =>
					/^themes\/[^/]+\/(templates|parts)\/.+\.html$/.test( c.file ) && rawHtml( c.text || '' )
			)
			.map( ( c ) => c.file ),
		...codeChanges( s )
			.filter(
				( c ) =>
					/^themes\/[^/]+\/(?:templates\/[^/]+|(?:page|front-page|home|index|singular|single)[\w-]*)\.php$/.test(
						c.file
					) || /Template Name:/.test( c.text || '' )
			)
			.map( ( c ) => c.file ),
		...( s.content || [] )
			.filter( ( c ) => c.type === 'wp_template' && rawHtml( c.content ) )
			.map( ( c ) => `saved template "${ c.slug }"` ),
	];
	if ( templates.length ) return fail( `templates of raw HTML: ${ templates.join( ', ' ) }` );
	return pass( `"${ page.title }" built from blocks: ${ Object.keys( blocks ).join( ', ' ) }` );
} );

// --- Design changes through theme.json -----------------------------------------

// The theme has a valid style variation (`styles/*.json`) whose palette or
// background differs from the theme's own, and no stylesheet carries a
// dark mode of its own (`prefers-color-scheme`, `.dark`-style selectors).
export const darkStyleVariation = check( ( d, vars ) => {
	const s = site( d, vars );
	const parse = ( text ) => {
		try {
			return JSON.parse( text );
		} catch {
			return null;
		}
	};
	const base = parse( s.themeFiles?.[ 'theme.json' ] || '{}' ) || {};
	const look = ( json ) =>
		JSON.stringify( [
			json?.settings?.color?.palette ?? null,
			json?.styles?.color?.background ?? null,
		] );
	const variations = Object.entries( s.themeFiles || {} ).filter( ( [ file ] ) =>
		/^styles\/[^/]+\.json$/.test( file )
	);
	if ( ! variations.length )
		return fail( `${ s.theme?.stylesheet } has no styles/*.json variation` );
	const invalid = variations.filter( ( [ , text ] ) => ! parse( text )?.version );
	if ( invalid.length )
		return fail( `invalid variation(s): ${ invalid.map( ( [ file ] ) => file ).join( ', ' ) }` );
	const effective = ( json ) =>
		look( {
			settings: {
				color: { palette: json.settings?.color?.palette ?? base.settings?.color?.palette },
			},
			styles: {
				color: { background: json.styles?.color?.background ?? base.styles?.color?.background },
			},
		} );
	const differing = variations.filter(
		( [ , text ] ) => effective( parse( text ) ) !== look( base )
	);
	if ( ! differing.length )
		return fail(
			`no variation changes the palette or background: ${ variations
				.map( ( [ f ] ) => f )
				.join( ', ' ) }`
		);
	const darkCss = stylesheets( s ).filter( ( { css } ) =>
		/prefers-color-scheme|(?:^|[\s,>+~}(])(?:html|body)?\.(?:is-)?dark(?:-mode|-theme)?(?![\w-])|\[data-(?:theme|color-scheme|mode)\s*=\s*["']?dark/i.test(
			css
		)
	);
	if ( darkCss.length )
		return fail( `dark-mode CSS in ${ darkCss.map( ( c ) => c.source ).join( ', ' ) }` );
	return pass(
		`variation ${ differing
			.map( ( [ f ] ) => f )
			.join( ', ' ) } changes the colors, no dark-mode CSS`
	);
} );

// Headings use Georgia and body text is a dark gray, set in theme.json or
// saved Global Styles, and no stylesheet has a rule for headings or the body.
export const typographyInThemeJson = check( ( d, vars ) => {
	const s = site( d, vars );
	const elements = s.mergedStyles?.elements || {};
	const font = ( el ) =>
		resolvePreset( el?.typography?.fontFamily, 'font-family', s.fontFamilies, 'fontFamily' );
	const fonts = [ 1, 2, 3, 4, 5, 6 ].map(
		( n ) => font( elements[ `h${ n }` ] ) ?? font( elements.heading )
	);
	const notGeorgia = fonts.filter( ( f ) => ! /georgia/i.test( String( f ?? '' ) ) );
	if ( notGeorgia.length )
		return fail( `heading font families in the merged styles: ${ JSON.stringify( fonts ) }` );
	const text = resolvePreset( s.mergedStyles?.color?.text, 'color', s.palette, 'color' );
	const channels = rgb( text );
	const original = vars.originalTextColor && rgb( vars.originalTextColor );
	const average = channels && channels.reduce( ( a, b ) => a + b, 0 ) / 3;
	const darkGray =
		channels &&
		Math.max( ...channels ) - Math.min( ...channels ) <= 0x20 &&
		average >= 0x20 &&
		average <= 0x90 &&
		! ( original && original.every( ( v, i ) => v === channels[ i ] ) );
	if ( ! darkGray )
		return fail( `body text color in the merged styles is ${ text ?? 'unset' }, not a dark gray` );
	const target =
		/(?:^|[\s>+~(])(?:h[1-6]|body)(?![\w-])|\.wp-block-(?:heading|post-title)(?![\w-])/;
	const rules = stylesheets( s ).flatMap( ( { source, css } ) =>
		cssRules( css )
			.filter( ( r ) => ! r.selectors[ 0 ]?.startsWith( '@' ) )
			.flatMap( ( r ) => r.selectors.filter( ( sel ) => target.test( sel ) ) )
			.map( ( sel ) => `${ sel } (${ source })` )
	);
	if ( rules.length )
		return fail( `CSS rules for headings or the body: ${ rules.slice( 0, 6 ).join( ', ' ) }` );
	return pass( `headings in ${ fonts[ 0 ] }, body text ${ text }, no heading or body CSS` );
} );

// --- Visual fixes that reach the render ----------------------------------------

// The seeded gradient (vars.gradient) no longer applies to vars.pseudoSelector:
// its declaration is gone, or a later rule for the same pseudo-element sets
// `background` to none/transparent/white or `display`/`content` to none.
export const pseudoGradientRemoved = check( ( d, vars ) => {
	const s = site( d, vars );
	const norm = ( text ) => String( text ).toLowerCase().replace( /\s+/g, '' );
	const pseudo = ( sel ) =>
		sel
			.toLowerCase()
			.replace( /\s+/g, ' ' )
			.trim()
			.replace( /(?<!:):(before|after)$/, '::$1' );
	const target = pseudo( vars.pseudoSelector );
	const gradient = norm( vars.gradient );
	// The pseudo-element itself, alone or under a more specific ancestor.
	const matches = ( sel ) => {
		const p = pseudo( sel );
		return p === target || p.endsWith( ` ${ target }` ) || p.endsWith( `>${ target }` );
	};
	const rules = stylesheets( s ).flatMap( ( { source, css } ) =>
		cssRules( css )
			.filter( ( r ) => r.selectors.some( matches ) )
			.map( ( r ) => ( { source, body: norm( r.body ) } ) )
	);
	const seeded = rules.findLastIndex( ( r ) => r.body.includes( gradient ) );
	if ( seeded < 0 ) return pass( `the gradient on ${ vars.pseudoSelector } is gone` );
	const override = rules
		.slice( seeded + 1 )
		.find( ( r ) =>
			/(?:^|;)(?:background:(?:none|transparent|white|#fff|#ffffff|var\(--wp--preset--color--(?:base|white)\))(?:!important)?(?:;|$)|background-image:none|display:none|content:none)/.test(
				r.body
			)
		);
	return override
		? pass( `a later ${ vars.pseudoSelector } rule in ${ override.source } overrides the gradient` )
		: fail(
				`the gradient still applies to ${ vars.pseudoSelector } (${ rules[ seeded ].source })`
		  );
} );

// Routing: every skill in `vars.skills` was loaded before the run's stop call
// (`vars.stopAt`), that is, before the agent started the work. A run that never
// reached a stop call is judged on all of its calls.
export const skillsLoadedFirst = check( ( d, vars ) => {
	const calls = d.stoppedAt
		? ( d.toolCalls || [] ).slice( 0, d.stoppedAt.index )
		: d.toolCalls || [];
	const loaded = calls.filter( ( c ) => c.name === 'Skill' ).map( ( c ) => c.input?.name );
	const missing = ( vars.skills || [] ).filter( ( name ) => ! loaded.includes( name ) );
	const before = d.stoppedAt ? `before ${ d.stoppedAt.toolName }` : 'in the whole run';
	return missing.length
		? fail(
				`not loaded ${ before }: ${ missing.join( ', ' ) }; loaded: ${ JSON.stringify( loaded ) }`
		  )
		: pass( `loaded ${ before }: ${ JSON.stringify( loaded ) }` );
} );
