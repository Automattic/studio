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

// The site a case is about: the one named `vars.siteName`; with a seeded
// active site, that one, as the request is about it; otherwise the site the
// turn created.
function site( d, vars ) {
	const sites = d.outcome?.sites || [];
	const created = sites.filter( ( s ) => s.created );
	if ( ! vars.siteName && ! vars.seed?.activeSite && created.length > 1 ) {
		throw new Error(
			`the turn created ${ created.length } sites: ${ created
				.map( ( s ) => `"${ s.name }"` )
				.join( ', ' ) }`
		);
	}
	const found = vars.siteName
		? sites.find( ( s ) => s.name === vars.siteName )
		: ( vars.seed?.activeSite ? null : created[ 0 ] ) || sites.find( ( s ) => ! s.created );
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

// The rendered home page, as the capture saved it.
const homeHtml = ( s ) => ( s.home?.htmlFile ? readFileSync( s.home.htmlFile, 'utf8' ) : '' );

// The rendered home page shows each `vars.homeText`, and each plugin in
// `vars.plugins` is still active: the feature works, not just the site.
// (Both are lists of objects, like `followUps`, so promptfoo keeps them in one test.)
export const featureStillWorks = check( ( d, vars ) => {
	const s = site( d, vars );
	const plugins = ( vars.plugins || [] ).map( ( p ) => p.name );
	const texts = ( vars.homeText || [] ).map( ( t ) => t.text );
	const inactive = plugins.filter( ( plugin ) => ! ( s.plugins || [] ).includes( plugin ) );
	if ( inactive.length )
		return fail( `not active: ${ inactive.join( ', ' ) }; active: ${ s.plugins }` );
	const html = homeHtml( s );
	const missing = texts.filter( ( text ) => ! html.includes( text ) );
	if ( missing.length ) return fail( `home page does not show: ${ missing.join( ', ' ) }` );
	return pass( `active: ${ plugins.join( ', ' ) }; home page shows ${ texts.join( ', ' ) }` );
} );

// Every image on the rendered home page loads from the site itself, and
// there are at least `vars.minImages` of them.
export const homeImagesLoad = check( ( d, vars ) => {
	const s = site( d, vars );
	const images = s.home?.images || [];
	const broken = images.filter( ( image ) => image.status !== 200 );
	if ( images.length < ( vars.minImages ?? 1 ) )
		return fail( `home page shows ${ images.length } images, expected ${ vars.minImages ?? 1 }` );
	if ( broken.length )
		return fail(
			`images that do not load from the site: ${ broken
				.map( ( image ) => `${ image.src } (${ image.status ?? 'another site' })` )
				.join( ', ' ) }`
		);
	return pass( `all ${ images.length } home page images load from the site` );
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
// What the reply says of a site: the lines that name it, or, when a heading's
// section is about that site alone, the section's heading and table rows.
export const classifiesPreviewAndRemote = check( ( d ) => {
	const text = reply( d ).toLowerCase();
	const sections = text.split( /\r?\n(?=#{1,6}\s)/ );
	const sites = [ [ 'abc123-studio.wp.build' ], [ 'myprod.wordpress.com', 'my production site' ] ];
	const about = ( names, others ) => {
		const named = ( t ) => names.some( ( n ) => t.includes( n ) );
		const own = sections.filter( ( t ) => named( t ) && ! others.some( ( n ) => t.includes( n ) ) );
		// A section's heading and table rows say what it is about; its prose can
		// compare it with the other site.
		const fields = own.flatMap( ( t ) =>
			t.split( /\r?\n/ ).filter( ( l ) => /^\s*(#|\|)/.test( l ) )
		);
		return own.length ? fields.join( ' ' ) : text.split( /\r?\n/ ).filter( named ).join( ' ' );
	};
	const preview = about( sites[ 0 ], sites[ 1 ] );
	const remote = about( sites[ 1 ], sites[ 0 ] );
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

// No site was created or changed, and the user was asked whether to use the
// active site or make a new one: by a question to the user, or in the reply.
export const asksCurrentOrNew = check( ( d, vars ) => {
	const created = ( d.outcome?.sites || [] ).filter( ( s ) => s.created );
	if ( created.length ) return fail( `created "${ created[ 0 ].name }" without asking` );
	if ( d.outcome?.requestSiteChanged ) return fail( 'changed the active site without asking' );
	const text = [ ...( d.questions || [] ).map( ( q ) => q.question ), reply( d ) ].join( '\n' );
	const active = vars.seed?.activeSite?.name;
	const offers =
		( /(current|existing|active)\s+site/i.test( text ) ||
			Boolean( active && text.includes( active ) ) ) &&
		/\b(new|separate|another|second)\b/i.test( text );
	return offers && asksUser( text )
		? pass( 'asked: active site or a new one' )
		: fail( `no current-or-new question: ${ text.slice( 0, 300 ) }` );
} );

// --- Site outcome checks -------------------------------------------------------

// A static front page with block content.
export const builtFrontPage = check( ( d, vars ) => {
	const s = site( d, vars );
	const front = frontPage( s );
	if ( s.showOnFront !== 'page' || ! front )
		return fail( `no static front page (show_on_front=${ s.showOnFront })` );
	if ( Object.keys( front.blocks ).length < 2 )
		return fail( `the front page has almost no blocks: ${ JSON.stringify( front.blocks ) }` );
	return pass( `front page "${ front.title }" built` );
} );

// The font families a theme.json declares, or undefined.
function fontFamilies( themeJson ) {
	try {
		return JSON.parse( themeJson ).settings?.typography?.fontFamilies;
	} catch {
		return undefined;
	}
}

// The design is the site's own, kept where WordPress keeps a design: a theme
// of its own (or a child theme), with the fonts it resolves self-hosted and a
// screenshot; or a theme from WordPress.org customized as the Site Editor does,
// through Global Styles (the wp_global_styles post) or templates and template
// parts saved for the theme (get_block_templates() in
// wp-includes/block-template-utils.php), with the fonts it adds served by the site.
export const siteHasItsOwnDesign = check( ( d, vars ) => {
	const s = site( d, vars );
	// The active theme has a WordPress.org release to compare with.
	if ( Array.isArray( s.themeChanges ) ) {
		const user = s.userGlobalStyles ?? {};
		const styled = Object.keys( user.styles ?? {} ).length > 0;
		const saved = ( s.content || [] )
			.filter( ( c ) => [ 'wp_template', 'wp_template_part' ].includes( c.type ) )
			.map( ( c ) => `${ c.type === 'wp_template' ? 'template' : 'part' } ${ c.slug }` );
		if ( ! styled && ! saved.length )
			return fail(
				`the site runs ${ s.theme.stylesheet } with no Global Styles and no saved templates or template parts`
			);
		const origin = new URL( s.url ).origin;
		const remote = [
			...JSON.stringify( user.settings?.typography ?? {} ).matchAll( /"(https?:[^"]+)"/g ),
		]
			.map( ( m ) => m[ 1 ] )
			.filter( ( src ) => new URL( src ).origin !== origin );
		if ( remote.length )
			return fail(
				`Global Styles load fonts from another host: ${ remote.slice( 0, 3 ).join( ', ' ) }`
			);
		return pass(
			`${ s.theme.stylesheet } customized: ${ [ styled ? 'Global Styles' : '', ...saved ]
				.filter( Boolean )
				.join( ', ' ) }`
		);
	}
	// A child theme's theme.json is merged over its parent's, and font families
	// it declares replace the parent's (WP_Theme_JSON_Resolver::get_theme_data()
	// and WP_Theme_JSON::merge()); each file:./ source is in the theme declaring it.
	const own = fontFamilies( s.themeFiles?.[ 'theme.json' ] );
	const parent = own ? undefined : fontFamilies( s.parentThemeJson );
	const fileList = ( parent ? s.parentThemeFileList : s.themeFileList ) ?? [];
	const fontSources = [
		...JSON.stringify( own ?? parent ?? [] ).matchAll( /"file:\.\/([^"]+)"/g ),
	].map( ( m ) => m[ 1 ] );
	const missing = fontSources.filter( ( f ) => ! fileList.includes( f ) );
	if ( ! fontSources.length ) return fail( 'theme.json loads no self-hosted fonts' );
	if ( missing.length )
		return fail( `theme.json fonts missing from the theme: ${ missing.join( ', ' ) }` );
	if ( ! s.themeScreenshot?.startsWith( 'jpeg:' ) && ! s.themeScreenshot?.startsWith( 'png:' ) ) {
		return fail( `theme screenshot is ${ s.themeScreenshot ?? 'missing' }` );
	}
	return pass(
		`theme ${ s.theme.stylesheet }: ${ fontSources.length } self-hosted font file(s)${
			parent ? ` of ${ s.theme.template }` : ''
		}, screenshot ${ s.themeScreenshot }`
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
// The home page holds a slideshow of at least `minSlides` images, by any
// plugin or code: one frame holding them that shows fewer at once than it
// holds, as a slideshow or carousel does. A gallery shows all of its images.
export const slideshowOnHomePage = check( ( d, vars ) => {
	const frames = site( d, vars ).home?.imageFrames;
	if ( ! Array.isArray( frames ) )
		return fail( `the home page was not measured: ${ JSON.stringify( frames ) }` );
	const needed = vars.minSlides ?? 3;
	const slideshow = frames.find(
		( f ) => f.images >= needed && f.shown >= 1 && f.shown < f.images
	);
	return slideshow
		? pass(
				`${ slideshow.element } holds ${ slideshow.images } images and shows ${ slideshow.shown } at once`
		  )
		: fail( `no frame shows fewer of its images than it holds: ${ JSON.stringify( frames ) }` );
} );

export const storeHasProducts = check( ( d, vars ) => {
	const s = site( d, vars );
	if ( ! s.plugins.includes( 'woocommerce' ) )
		return fail( `WooCommerce is not active: ${ JSON.stringify( s.plugins ) }` );
	if ( s.shopPage !== 'publish' ) return fail( `the shop page is ${ s.shopPage || 'missing' }` );
	const forSale = ( s.products || [] ).filter( ( p ) => p.purchasable && p.visible );
	const needed = vars.minProducts ?? 1;
	return forSale.length >= needed
		? pass(
				`${ forSale.length } product(s) for sale in the shop: ${ forSale
					.map( ( p ) => `${ p.name } (${ p.price })` )
					.join( ', ' ) }`
		  )
		: fail(
				`${ forSale.length } of ${ needed } product(s) for sale; published: ${ JSON.stringify(
					s.products
				).slice( 0, 300 ) }`
		  );
} );

// The design lives in a child theme of vars.parentTheme, the parent is still
// its WordPress.org release, and headings use a serif face.
// Both places WordPress keeps a customization through the theme's updates: a
// child theme, or the Site Editor's Global Styles (the wp_global_styles post).
export const customizedThroughChildTheme = check( ( d, vars ) => {
	const s = site( d, vars );
	const child = s.theme.template === vars.parentTheme && s.theme.stylesheet !== vars.parentTheme;
	if ( ! child && s.theme.stylesheet !== vars.parentTheme ) {
		return fail(
			`active theme is ${ s.theme.stylesheet } (template ${ s.theme.template }), not ${ vars.parentTheme } or a child of it`
		);
	}
	const parentChanges = child ? s.parentThemeChanges : s.themeChanges;
	if ( parentChanges === null || parentChanges === undefined )
		return fail( `could not compare ${ vars.parentTheme } with its release` );
	if ( parentChanges.length )
		return fail(
			`${ vars.parentTheme } differs from its release: ${ parentChanges
				.slice( 0, 5 )
				.join( ', ' ) }`
		);
	// The released theme sets its own heading font, so on it only the user's
	// Global Styles show the customization.
	const user = JSON.stringify( s.userGlobalStyles?.styles?.elements?.heading ?? {} );
	const heading = child ? JSON.stringify( s.mergedStyles?.elements?.heading ?? {} ) + user : user;
	if ( ! /fontFamily/.test( heading ) )
		return fail( `no heading font family in the ${ child ? 'merged styles' : 'Global Styles' }` );
	return pass(
		`${ child ? `child theme ${ s.theme.stylesheet }` : 'Global Styles' }; ${
			vars.parentTheme
		} untouched; heading font ${ heading.match( /"fontFamily":"([^"]+)"/ )?.[ 1 ] }`
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
	// A slug as WordPress reads it from a block's classes (block-style-variations.php).
	const applied = ( content.match( /is-style-[^\s"\\]+/g ) || [] )
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

// The palette preset `vars.slug` resolves to a color other than
// `vars.originalValue`. The resolved palette lists core's, the theme's and the
// user's presets in that order, so the last of a slug is the one WordPress uses.
export const presetColorChanged = check( ( d, vars ) => {
	const color = ( site( d, vars ).palette || [] )
		.filter( ( p ) => p.slug === vars.slug )
		.pop()
		?.color?.toLowerCase();
	if ( ! color ) return fail( `no ${ vars.slug } color in the resolved palette` );
	return color === vars.originalValue.toLowerCase()
		? fail( `${ vars.slug } is still ${ color }` )
		: pass( `${ vars.slug } resolves to ${ color }` );
} );

const pathOf = ( url ) => new URL( url ).pathname.replace( /\/?$/, '/' );

// Each page the prompt asks for (`vars.pages`, by `title`) is published, is in
// the rendered navigation, and its link opens it.
export const menuReachesPages = check( ( d, vars ) => {
	const s = site( d, vars );
	const published = ( s.content || [] ).filter( ( c ) => c.type === 'page' && ! c.isFront );
	const titled = ( title ) =>
		published.find( ( p ) => p.title.trim().toLowerCase() === title.toLowerCase() );
	const wanted = vars.pages.map( ( p ) => p.title );
	const absent = wanted.filter( ( title ) => ! titled( title ) );
	if ( absent.length )
		return fail(
			`no published page titled ${ absent
				.map( ( t ) => `"${ t }"` )
				.join( ', ' ) }: ${ JSON.stringify( published.map( ( p ) => p.title ) ) }`
		);
	const reached = Object.values( s.home?.navTargets || {} )
		.filter( ( t ) => t.status === 200 )
		.map( ( t ) => pathOf( t.url ) );
	const missing = wanted.filter(
		( title ) => ! reached.includes( pathOf( titled( title ).link ) )
	);
	if ( missing.length )
		return fail(
			`the navigation does not open ${ missing
				.map( ( t ) => `"${ t }"` )
				.join( ', ' ) }; it leads to ${ JSON.stringify( s.home?.navTargets ) }`
		);
	return pass( `the navigation opens ${ wanted.map( ( t ) => `"${ t }"` ).join( ', ' ) }` );
} );

// The abilities the turn added, run through the Abilities API's REST routes by
// the case's inspection (INSPECT_JSON: each added ability, and each run with
// its method, user, input, status and body). Each one that writes is in REST
// and refuses a visitor; run by an administrator, one adds the case's book,
// and then a read-only one lists it.
export const abilitiesWork = check( ( d ) => {
	const raw = ( d.inspections || [] )
		.map( ( i ) => i.stdout )
		.join( '\n' )
		.match( /INSPECT_JSON=(.*)/ );
	if ( ! raw )
		return fail(
			`no abilities inspection: ${ JSON.stringify( d.inspections || d.error || null ).slice(
				0,
				300
			) }`
		);
	const { book, abilities, runs } = JSON.parse( raw[ 1 ] );
	if ( ! abilities.length ) return fail( 'no ability was added' );
	const hidden = abilities.filter( ( a ) => ! a.inRest ).map( ( a ) => a.name );
	if ( hidden.length )
		return fail( `not shown in REST (meta.show_in_rest): ${ hidden.join( ', ' ) }` );
	const ok = ( r ) => r.status >= 200 && r.status < 300;
	const open = runs.filter( ( r ) => r.user === 0 && ok( r ) ).map( ( r ) => r.name );
	if ( open.length ) return fail( `a visitor ran ${ open.join( ', ' ) }` );
	const adds = runs.filter( ( r ) => r.user !== 0 && r.method !== 'GET' );
	if ( ! adds.some( ok ) )
		return fail(
			`no ability added the book: ${ JSON.stringify(
				adds.map( ( r ) => [ r.name, r.status, r.body ] )
			).slice( 0, 300 ) }`
		);
	const reads = runs.filter( ( r ) => r.method === 'GET' );
	if ( ! reads.length )
		return fail( 'no read-only ability (meta.annotations.readonly) to list the books' );
	const lists = reads.filter( ( r ) => ok( r ) && JSON.stringify( r.body ).includes( book ) );
	return lists.length
		? pass(
				`${ adds.find( ok ).name } added "${ book }" and ${
					lists[ 0 ].name
				} lists it; a visitor is refused`
		  )
		: fail(
				`no read-only ability lists "${ book }": ${ JSON.stringify(
					reads.map( ( r ) => [ r.name, r.status, r.body ] )
				).slice( 0, 300 ) }`
		  );
} );

// The home page shows a block that a plugin registers with WordPress, with an
// editor script so editors can insert it, and it renders `vars.text`.
export const pluginBlockRendered = check( ( d, vars ) => {
	const s = site( d, vars );
	const used = Object.keys( frontPage( s )?.blocks || {} );
	const fromPlugin = ( s.blockTypes || [] ).filter(
		( t ) =>
			used.includes( t.name ) &&
			t.editorScripts.some( ( src ) => String( src ).includes( '/wp-content/plugins/' ) )
	);
	if ( ! fromPlugin.length )
		return fail(
			`the home page uses no block a plugin registers with an editor script; it uses ${ JSON.stringify(
				used
			) }, and plugins register ${ JSON.stringify( s.blockTypes ) }`
		);
	if ( ! homeHtml( s ).includes( vars.text ) )
		return fail( `the rendered home page does not show "${ vars.text }"` );
	return pass( `the home page shows ${ fromPlugin.map( ( t ) => t.name ).join( ', ' ) }` );
} );

// At least `vars.minPosts` new posts, each category in `vars.categories` used,
// and the rendered home page lists every new post.
export const blogPostsOnHome = check( ( d, vars ) => {
	const s = site( d, vars );
	const posts = ( s.content || [] ).filter(
		( c ) => c.type === 'post' && c.slug !== 'hello-world'
	);
	if ( posts.length < vars.minPosts ) return fail( `${ posts.length } new published post(s)` );
	const empty = vars.categories
		.map( ( c ) => c.name )
		.filter( ( name ) => ! posts.some( ( p ) => p.categories.includes( name ) ) );
	if ( empty.length ) return fail( `no new post is filed under ${ empty.join( ', ' ) }` );
	const html = homeHtml( s );
	const unlisted = posts.filter( ( p ) => ! html.includes( p.renderedTitle ) );
	if ( unlisted.length )
		return fail(
			`the home page does not list ${ unlisted.map( ( p ) => `"${ p.title }"` ).join( ', ' ) }`
		);
	return pass(
		`${ posts.length } posts in ${ vars.categories
			.map( ( c ) => c.name )
			.join( ', ' ) }, all on the home page`
	);
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
