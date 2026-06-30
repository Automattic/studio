// src/blocks/interactivity-plugin.ts
//
// Custom Interactivity-API blocks as DATA (spec §6 — Plan A: reveal + sticky;
// B1: tabs + slider + modal). buildInteractivityPlugin() returns a
// ReplicaBlockPlugin consumed by the existing writeReplicaFilesToHost plugin
// path + `wp plugin activate`.
//
// No build step (verified against WP 7.0 core): block.json editorScript +
// viewScriptModule. editor.js uses global wp packages; view.js is hand-written
// ESM. THE LOAD-BEARING DETAIL for view.js is view.asset.php — module
// dependencies come ONLY from that sibling file; without it the frontend import
// map omits @wordpress/interactivity and the bare import fails.
//
// Behavior params (IO threshold, animation, scroll offset, active classes,
// autoplay interval) arrive via data-wp-context on the EMITTED MARKUP
// (emit-blocks/chrome-parts), not via these static files — one plugin serves
// every site. The B1 blocks (tabs/slider/modal) wrap VERBATIM source markup
// and drive behavior by toggling SOURCE-AUTHORED classes via the
// imperative-from-init pattern (root data-wp-init, plain DOM wiring — the
// dla/sticky precedent); they ship NO style.css because source CSS owns all
// visuals.
//
import type { ReplicaBlockPlugin } from '../lib/preview/types.js';

export const PLUGIN_SLUG = 'dla-interactivity';

const PLUGIN_PHP = `<?php
/**
 * Plugin Name: DLA Interactivity Blocks
 * Description: Native Interactivity API blocks emitted by the data-liberation local-site converter (reveal, sticky, tabs, slider, modal).
 * Version: 1.0.0
 * Requires at least: 6.7
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    register_block_type( __DIR__ . '/blocks/reveal' );
    register_block_type( __DIR__ . '/blocks/sticky' );
    register_block_type( __DIR__ . '/blocks/tabs' );
    register_block_type( __DIR__ . '/blocks/slider' );
    register_block_type( __DIR__ . '/blocks/modal' );
} );
`;

const VIEW_ASSET_PHP = `<?php return array( 'dependencies' => array( '@wordpress/interactivity' ), 'version' => '1.0.0' );
`;

const EDITOR_ASSET_PHP = `<?php return array( 'dependencies' => array( 'wp-blocks', 'wp-block-editor', 'wp-element' ), 'version' => '1.0.0' );
`;

function contentAttribute(selector: string): { type: string; source: string; selector: string } {
  return { type: 'string', source: 'html', selector };
}

function editorJs(kind: 'reveal' | 'sticky' | 'tabs' | 'slider' | 'modal'): string {
  const blockName = `dla/${kind}`;
  const baseClass = `wp-block-dla-${kind}`;
  const tagName = kind === 'sticky' ? 'div' : 'section';
  // reveal's inner is NESTED BLOCK COMMENTS (the emitter converts children to
  // core blocks), so html-sourced content cannot see it — the post parser
  // excises inner-block regions from innerHTML. reveal therefore uses
  // InnerBlocks (children natively editable; save = InnerBlocks.Content);
  // tabs/slider/modal wrap VERBATIM html (block-shaped comments stripped at
  // emission) where html-sourcing is exactly right. Editor preview renders
  // unstyled-but-structured (source CSS is not loaded in the editor iframe) —
  // accepted; RawHTML sits behind pointer-events:none so live anchors in the
  // verbatim markup cannot navigate the editor frame.
  return `( function ( blocks, blockEditor, element ) {
\tvar el = element.createElement;
\tvar RawHTML = element.RawHTML;
\tvar blockName = '${blockName}';
\tvar baseClass = '${baseClass}';
\tvar tagName = '${tagName}';

\tfunction joinClasses() {
\t\treturn Array.prototype.slice.call( arguments ).filter( Boolean ).join( ' ' );
\t}

\tfunction safeJson( value ) {
\t\treturn JSON.stringify( value ).replace( /--/g, '\\\\u002d\\\\u002d' ).replace( /'/g, '\\\\u0027' );
\t}

\tfunction content( attributes ) {
\t\tif ( ! attributes.content ) return null;
\t\t// pointer-events:none in EDIT only — save() never calls this wrapper.
\t\treturn el( 'div', { style: { pointerEvents: 'none' } }, el( RawHTML, { children: attributes.content } ) );
\t}

\tfunction savedContent( attributes ) {
\t\treturn attributes.content ? el( RawHTML, { children: attributes.content } ) : null;
\t}

\tfunction numberOr( value, fallback ) {
\t\t// NOT ||: threshold 0 / offset 0 / durationMs 0 are legitimate source
\t\t// values — a || fallback would drift save() from the emitted markup and
\t\t// invalidate the block.
\t\treturn typeof value === 'number' ? value : fallback;
\t}

\tfunction wrapperProps( attributes ) {
\t\tvar props = {
\t\t\tclassName: joinClasses( baseClass, attributes.className ),
\t\t};
\t\tif ( attributes.anchor ) props.id = attributes.anchor;
\t\tif ( blockName === 'dla/reveal' ) {
\t\t\tprops.style = {
\t\t\t\t'--dla-reveal-y': attributes.translateY || '18px',
\t\t\t\t'--dla-reveal-ms': numberOr( attributes.durationMs, 600 ) + 'ms',
\t\t\t};
\t\t\tprops[ 'data-wp-interactive' ] = 'dla/reveal';
\t\t\tprops[ 'data-wp-context' ] = safeJson( {
\t\t\t\tvisible: false,
\t\t\t\tthreshold: numberOr( attributes.threshold, 0.12 ),
\t\t\t} );
\t\t\tprops[ 'data-wp-init' ] = 'callbacks.init';
\t\t\tprops[ 'data-wp-class--is-visible' ] = 'context.visible';
\t\t} else if ( blockName === 'dla/sticky' ) {
\t\t\tprops.style = { display: 'none' };
\t\t\tprops[ 'data-wp-interactive' ] = 'dla/sticky';
\t\t\tprops[ 'data-wp-context' ] = safeJson( {
\t\t\t\ttoggleClass: attributes.toggleClass || 'is-scrolled',
\t\t\t\toffset: numberOr( attributes.offset, 8 ),
\t\t\t} );
\t\t\tprops[ 'data-wp-init' ] = 'callbacks.init';
\t\t} else if ( blockName === 'dla/tabs' ) {
\t\t\tprops[ 'data-wp-interactive' ] = 'dla/tabs';
\t\t\tprops[ 'data-wp-context' ] = safeJson( {
\t\t\t\tactiveClass: attributes.activeClass || 'is-active',
\t\t\t} );
\t\t\tprops[ 'data-wp-init' ] = 'callbacks.init';
\t\t} else if ( blockName === 'dla/slider' ) {
\t\t\tvar ctx = { activeClass: attributes.activeClass || 'is-current' };
\t\t\tif ( attributes.intervalMs ) ctx.intervalMs = attributes.intervalMs;
\t\t\tprops[ 'data-wp-interactive' ] = 'dla/slider';
\t\t\tprops[ 'data-wp-context' ] = safeJson( ctx );
\t\t\tprops[ 'data-wp-init' ] = 'callbacks.init';
\t\t} else if ( blockName === 'dla/modal' ) {
\t\t\tprops[ 'data-wp-interactive' ] = 'dla/modal';
\t\t\tprops[ 'data-wp-init' ] = 'callbacks.init';
\t\t}
\t\treturn props;
\t}

\tvar isReveal = blockName === 'dla/reveal';

\tblocks.registerBlockType( '${blockName}', {
\t\tedit: function ( props ) {
\t\t\tvar attributes = props.attributes;
\t\t\tvar blockProps = blockEditor.useBlockProps( wrapperProps( attributes ) );
\t\t\tif ( isReveal ) {
\t\t\t\treturn el( tagName, blockProps, el( blockEditor.InnerBlocks ) );
\t\t\t}
\t\t\treturn el( tagName, blockProps, content( attributes ) );
\t\t},
\t\tsave: function ( props ) {
\t\t\tvar attributes = props.attributes;
\t\t\tif ( isReveal ) {
\t\t\t\treturn el( tagName, wrapperProps( attributes ), el( blockEditor.InnerBlocks.Content ) );
\t\t\t}
\t\t\treturn el( tagName, wrapperProps( attributes ), savedContent( attributes ) );
\t\t},
\t} );
} )( window.wp.blocks, window.wp.blockEditor, window.wp.element );
`;
}

const REVEAL_BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/reveal',
      title: 'Reveal Section',
      category: 'design',
      description: 'Scroll-reveal section (IntersectionObserver via the Interactivity API).',
      supports: { interactivity: true, html: false },
      attributes: {
        anchor: { type: 'string' },
        className: { type: 'string' },
        // NO content attribute: reveal's inner is nested BLOCKS (heading/
        // paragraph children) — InnerBlocks owns them; html-sourcing would
        // capture only the whitespace between inner-block placeholders.
        threshold: { type: 'number', default: 0.12 },
        translateY: { type: 'string', default: '18px' },
        durationMs: { type: 'number', default: 600 },
      },
      editorScript: 'file:./editor.js',
      viewScriptModule: 'file:./view.js',
      style: 'file:./style.css',
    },
    null,
    '\t',
  ) + '\n';

// The js-capability gate is a NAMESPACED class on <html> added by THIS module
// (dla-reveal-js) — never the source's bare "js" class, which would arm the
// dormant carried html.js rules against every <section> on the page. No-JS =>
// class absent => content visible (SSR-first, spec §6 a11y triad).
const REVEAL_VIEW_JS = `import { store, getContext, getElement } from '@wordpress/interactivity';

document.documentElement.classList.add( 'dla-reveal-js' );

store( 'dla/reveal', {
	callbacks: {
		init() {
			const ctx = getContext();
			const { ref } = getElement();
			if ( window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
				ctx.visible = true;
				return;
			}
			const obs = new IntersectionObserver(
				( entries ) => {
					entries.forEach( ( e ) => {
						if ( e.isIntersecting ) {
							ctx.visible = true;
							obs.unobserve( e.target );
						}
					} );
				},
				{ threshold: ctx.threshold ?? 0.12 }
			);
			obs.observe( ref );
		},
	},
} );
`;

// Hidden state is gated on .dla-reveal-js (module ran) AND :not(.is-visible).
// Animation params are the catalog defaults; per-site params ride the emitted
// markup's inline custom properties (--dla-reveal-y / --dla-reveal-ms).
//
// The transition rides the TARGET state (.is-visible) only: the gate class
// lands at MODULE time (post-first-paint — a block can't inject head-inline
// scripts the way the source site did), so a base-rule transition ANIMATED
// below-fold sections visible→hidden on gate arrival (a 600ms fade-OUT flash;
// probe caught opacity 0.0088 mid-fade). State-scoped, gate arrival snaps
// them hidden instantly, while the 0→1 reveal still animates because the
// transition is active on the state being ENTERED. Residual: a brief
// flash-of-visible BEFORE the module runs is unavoidable without a
// head-inline script — accepted v1 (matches the no-JS-resilient SSR-first
// posture: content is visible until JS proves it can reveal it).
const REVEAL_STYLE_CSS = `.dla-reveal-js .wp-block-dla-reveal:not(.is-visible) {
	opacity: 0;
	transform: translateY( var( --dla-reveal-y, 18px ) );
}
.dla-reveal-js .wp-block-dla-reveal.is-visible {
	transition: opacity var( --dla-reveal-ms, 600ms ) ease, transform var( --dla-reveal-ms, 600ms ) ease;
}
@media (prefers-reduced-motion: reduce) {
	.dla-reveal-js .wp-block-dla-reveal:not(.is-visible) {
		opacity: 1;
		transform: none;
	}
	.dla-reveal-js .wp-block-dla-reveal.is-visible {
		transition: none;
	}
}
`;

const STICKY_BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/sticky',
      title: 'Sticky Header State',
      category: 'design',
      description: 'Scroll-reactive header state (toggles the source-authored class past an offset).',
      supports: { interactivity: true, html: false },
      attributes: {
        className: { type: 'string' },
        toggleClass: { type: 'string', default: 'is-scrolled' },
        offset: { type: 'number', default: 8 },
        content: contentAttribute('.wp-block-dla-sticky'),
      },
      editorScript: 'file:./editor.js',
      viewScriptModule: 'file:./view.js',
    },
    null,
    '\t',
  ) + '\n';

// The toggled class must land on the SAME element the source css targets
// (header.<class> rules in carried css). The block renders INSIDE the header
// template part, so it climbs to the nearest <header> — the part wrapper that
// source header{} rules already style (stage 1d). Falls back to its own ref
// when no header ancestor exists.
const STICKY_VIEW_JS = `import { store, getContext, getElement } from '@wordpress/interactivity';

store( 'dla/sticky', {
	callbacks: {
		init() {
			const ctx = getContext();
			const { ref } = getElement();
			const target = ref.closest( 'header' ) ?? ref;
			const toggleClass = ctx.toggleClass ?? 'is-scrolled';
			const offset = ctx.offset ?? 8;
			const apply = () => target.classList.toggle( toggleClass, window.scrollY > offset );
			apply();
			window.addEventListener( 'scroll', apply, { passive: true } );
		},
	},
} );
`;

const TABS_BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/tabs',
      title: 'Tabs Section',
      category: 'design',
      description: 'Tabbed section (verbatim source markup; toggles the source-authored active class).',
      supports: { interactivity: true, html: false },
      attributes: {
        anchor: { type: 'string' },
        className: { type: 'string' },
        activeClass: { type: 'string', default: 'is-active' },
        content: contentAttribute('.wp-block-dla-tabs'),
      },
      editorScript: 'file:./editor.js',
      viewScriptModule: 'file:./view.js',
    },
    null,
    '\t',
  ) + '\n';

// Imperative-from-init (the dla/sticky precedent): root-only data-wp-init,
// plain DOM wiring inside callbacks.init — the verbatim inner markup stays
// untouched (no descendant-directive injection). Source markup is the initial
// state; select() normalizes roving tabindex/aria from it.
const TABS_VIEW_JS = `import { store, getContext, getElement } from '@wordpress/interactivity';

store( 'dla/tabs', {
	callbacks: {
		init() {
			const ctx = getContext();
			const { ref } = getElement();
			const activeClass = ctx.activeClass ?? 'is-active';
			const tabs = Array.from( ref.querySelectorAll( '[role="tab"]' ) );
			const panels = Array.from( ref.querySelectorAll( '[role="tabpanel"]' ) );
			const panelFor = ( tab, i ) => {
				const id = tab.getAttribute( 'aria-controls' );
				return ( id && ref.querySelector( '#' + CSS.escape( id ) ) ) || panels[ i ] || null;
			};
			const select = ( idx ) => {
				tabs.forEach( ( t, i ) => {
					const on = i === idx;
					t.classList.toggle( activeClass, on );
					t.setAttribute( 'aria-selected', on ? 'true' : 'false' );
					t.tabIndex = on ? 0 : -1;
					const p = panelFor( t, i );
					if ( p ) p.hidden = ! on;
				} );
			};
			tabs.forEach( ( t, i ) => {
				t.addEventListener( 'click', () => select( i ) );
				t.addEventListener( 'keydown', ( e ) => {
					if ( e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' ) return;
					const next = ( i + ( e.key === 'ArrowRight' ? 1 : tabs.length - 1 ) ) % tabs.length;
					select( next );
					tabs[ next ].focus();
				} );
			} );
			// Source markup is the initial state; normalize roving tabindex from it.
			const initial = tabs.findIndex( ( t ) => t.getAttribute( 'aria-selected' ) === 'true' );
			select( initial >= 0 ? initial : 0 );
		},
	},
} );
`;

const SLIDER_BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/slider',
      title: 'Slider Section',
      category: 'design',
      description: 'Carousel section (verbatim source markup; moves the source-authored active class).',
      supports: { interactivity: true, html: false },
      attributes: {
        anchor: { type: 'string' },
        className: { type: 'string' },
        activeClass: { type: 'string', default: 'is-current' },
        intervalMs: { type: 'number' },
        content: contentAttribute('.wp-block-dla-slider'),
      },
      editorScript: 'file:./editor.js',
      viewScriptModule: 'file:./view.js',
    },
    null,
    '\t',
  ) + '\n';

// Slide list derived STRUCTURALLY: the siblings of the element currently
// carrying activeClass (source markup is the initial state) — no slide-class
// name list. Autoplay only when the emitted context set intervalMs AND the
// visitor does not prefer reduced motion; pointer hover pauses it.
const SLIDER_VIEW_JS = `import { store, getContext, getElement } from '@wordpress/interactivity';

store( 'dla/slider', {
	callbacks: {
		init() {
			const ctx = getContext();
			const { ref } = getElement();
			const activeClass = ctx.activeClass ?? 'is-current';
			const current = ref.querySelector( '.' + CSS.escape( activeClass ) );
			const list = current ? Array.from( current.parentElement.children ) : [];
			if ( list.length < 2 ) return;
			let idx = list.indexOf( current );
			const go = ( n ) => {
				list[ idx ].classList.remove( activeClass );
				idx = ( n + list.length ) % list.length;
				list[ idx ].classList.add( activeClass );
			};
			ref.querySelector( '.next, [data-next]' )?.addEventListener( 'click', () => go( idx + 1 ) );
			ref.querySelector( '.prev, [data-prev]' )?.addEventListener( 'click', () => go( idx - 1 ) );
			// Keyboard: arrows operate the slider whenever focus is inside it (the
			// prev/next buttons are already focusable; no tabindex injection — the
			// verbatim inner markup must stay untouched).
			ref.addEventListener( 'keydown', ( e ) => {
				if ( e.key === 'ArrowRight' ) go( idx + 1 );
				else if ( e.key === 'ArrowLeft' ) go( idx - 1 );
			} );
			const reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
			if ( ctx.intervalMs && ! reduced ) {
				let timer = setInterval( () => go( idx + 1 ), ctx.intervalMs );
				ref.addEventListener( 'pointerenter', () => clearInterval( timer ) );
				ref.addEventListener( 'pointerleave', () => { timer = setInterval( () => go( idx + 1 ), ctx.intervalMs ); } );
			}
		},
	},
} );
`;

const MODAL_BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/modal',
      title: 'Modal Section',
      category: 'design',
      description: 'Section with a native dialog modal (verbatim source markup; showModal/close wiring).',
      supports: { interactivity: true, html: false },
      attributes: {
        anchor: { type: 'string' },
        className: { type: 'string' },
        content: contentAttribute('.wp-block-dla-modal'),
      },
      editorScript: 'file:./editor.js',
      viewScriptModule: 'file:./view.js',
    },
    null,
    '\t',
  ) + '\n';

// Native <dialog> semantics carry the a11y load (Esc close, focus trap,
// ::backdrop). withSyncEvent precision: it opts DIRECTIVE handlers
// (data-wp-on--*) out of async scheduling — this listener is a plain
// addEventListener inside init, which is already synchronous, so the wrapper
// passes through inert. Kept deliberately: it becomes load-bearing if this
// wiring ever moves to a data-wp-on--click directive (WP 7.0 exports it from
// the interactivity module — verified against a live install).
const MODAL_VIEW_JS = `import { store, getElement, withSyncEvent } from '@wordpress/interactivity';

store( 'dla/modal', {
	callbacks: {
		init() {
			const { ref } = getElement();
			const dialog = ref.querySelector( 'dialog' );
			if ( ! dialog ) return;
			// Trigger: first button OUTSIDE the dialog within the section.
			const trigger = Array.from( ref.querySelectorAll( 'button' ) ).find( ( b ) => ! dialog.contains( b ) );
			trigger?.addEventListener( 'click', () => dialog.showModal() );
			// Close: any [data-close]/.close button inside; backdrop click closes.
			dialog.querySelectorAll( '[data-close], .close' ).forEach( ( b ) =>
				b.addEventListener( 'click', () => dialog.close() )
			);
			dialog.addEventListener( 'click', withSyncEvent( ( e ) => {
				if ( e.target === dialog ) dialog.close(); // backdrop — Esc is native <dialog>
			} ) );
		},
	},
} );
`;

export function buildInteractivityPlugin(): ReplicaBlockPlugin {
  return {
    slug: PLUGIN_SLUG,
    files: [
      { relativePath: 'plugin.php', content: PLUGIN_PHP },
      { relativePath: 'blocks/reveal/block.json', content: REVEAL_BLOCK_JSON },
      { relativePath: 'blocks/reveal/editor.js', content: editorJs('reveal') },
      { relativePath: 'blocks/reveal/editor.asset.php', content: EDITOR_ASSET_PHP },
      { relativePath: 'blocks/reveal/view.js', content: REVEAL_VIEW_JS },
      { relativePath: 'blocks/reveal/view.asset.php', content: VIEW_ASSET_PHP },
      { relativePath: 'blocks/reveal/style.css', content: REVEAL_STYLE_CSS },
      { relativePath: 'blocks/sticky/block.json', content: STICKY_BLOCK_JSON },
      { relativePath: 'blocks/sticky/editor.js', content: editorJs('sticky') },
      { relativePath: 'blocks/sticky/editor.asset.php', content: EDITOR_ASSET_PHP },
      { relativePath: 'blocks/sticky/view.js', content: STICKY_VIEW_JS },
      { relativePath: 'blocks/sticky/view.asset.php', content: VIEW_ASSET_PHP },
      { relativePath: 'blocks/tabs/block.json', content: TABS_BLOCK_JSON },
      { relativePath: 'blocks/tabs/editor.js', content: editorJs('tabs') },
      { relativePath: 'blocks/tabs/editor.asset.php', content: EDITOR_ASSET_PHP },
      { relativePath: 'blocks/tabs/view.js', content: TABS_VIEW_JS },
      { relativePath: 'blocks/tabs/view.asset.php', content: VIEW_ASSET_PHP },
      { relativePath: 'blocks/slider/block.json', content: SLIDER_BLOCK_JSON },
      { relativePath: 'blocks/slider/editor.js', content: editorJs('slider') },
      { relativePath: 'blocks/slider/editor.asset.php', content: EDITOR_ASSET_PHP },
      { relativePath: 'blocks/slider/view.js', content: SLIDER_VIEW_JS },
      { relativePath: 'blocks/slider/view.asset.php', content: VIEW_ASSET_PHP },
      { relativePath: 'blocks/modal/block.json', content: MODAL_BLOCK_JSON },
      { relativePath: 'blocks/modal/editor.js', content: editorJs('modal') },
      { relativePath: 'blocks/modal/editor.asset.php', content: EDITOR_ASSET_PHP },
      { relativePath: 'blocks/modal/view.js', content: MODAL_VIEW_JS },
      { relativePath: 'blocks/modal/view.asset.php', content: VIEW_ASSET_PHP },
    ],
  };
}
