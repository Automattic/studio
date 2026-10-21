// Outcome assertions for the Studio Code agent eval.
//
// Each check judges what the turn left behind — the site's WordPress state,
// its rendered home page, its theme files, and what the user was told — not
// which tools the agent called. The runner captures that state after the turn
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
	// Each stylesheet on its own: in a blob joined with block markup, the
	// first rule's selector would start with the markup before it.
	const stylesheets = [
		...Object.entries( s.themeFiles || {} )
			.filter( ( [ file ] ) => file.endsWith( '.css' ) )
			.map( ( [ , text ] ) => text ),
		s.customCss || '',
		...[ ...all.matchAll( /<style[^>]*>([\s\S]*?)<\/style>/g ) ].map( ( m ) => m[ 1 ] ),
		...[ ...all.matchAll( /"css"\s*:\s*"((?:[^"\\]|\\.)*)"/g ) ].map( ( m ) =>
			JSON.parse( `"${ m[ 1 ] }"` )
		),
	];
	const offenders = [];
	for ( const sheet of stylesheets ) {
		const css = sheet.replace( /\/\*[\s\S]*?\*\//g, ' ' );
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
