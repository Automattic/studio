import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type {
	CapturedDialogInteraction,
	CapturedInitialDialog,
} from './screenshot/interaction-capture.js';

const DISCLOSURE_CSS =
	'details.dla-disclosure>summary{list-style:none;cursor:pointer;display:inline-block}' +
	'details.dla-disclosure>summary::-webkit-details-marker{display:none}' +
	'details.dla-disclosure:not([open])>.dla-dialog{display:none!important}' +
	'details.dla-disclosure[open]>.dla-dialog{display:block;position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#fff}' +
	'details.dla-disclosure[open]>.dla-dialog>:first-child{display:block!important;visibility:visible!important;opacity:1!important}' +
	'details.dla-disclosure:not(.dla-initial-dialog)[open]>summary{position:fixed;z-index:2147483647;right:1rem;top:1rem;padding:.5rem .75rem;background:#fff;color:#111;border:1px solid currentColor;border-radius:.25rem}' +
	'details.dla-disclosure:not(.dla-initial-dialog)[open]>summary:after{content:"Close"}' +
	'details.dla-initial-dialog>summary{position:fixed;z-index:2147483647;right:1rem;top:1rem}' +
	'details.dla-initial-dialog:not([open])>summary{display:none!important}';

const DISCLOSURE_RUNTIME = `(function(){function disclosures(){return document.querySelectorAll('details.dla-disclosure');}function update(details){var summary=details.querySelector(':scope > summary');if(!summary)return;var label=summary.getAttribute('data-dla-disclosure-label');if(label)summary.setAttribute('aria-label',details.open?'Close '+label:label);}function ready(){disclosures().forEach(function(details){update(details);details.addEventListener('toggle',function(){update(details);});});document.addEventListener('keydown',function(event){if(event.key!=='Escape')return;var open=Array.prototype.slice.call(disclosures()).filter(function(details){return details.open;}).pop();if(!open)return;event.preventDefault();open.open=false;var summary=open.querySelector(':scope > summary');if(summary)summary.focus();});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();})();`;

const GLOBAL_ATTRIBUTES = new Set( [
	'accesskey',
	'autocapitalize',
	'autofocus',
	'class',
	'contenteditable',
	'dir',
	'draggable',
	'enterkeyhint',
	'hidden',
	'id',
	'inert',
	'inputmode',
	'itemid',
	'itemprop',
	'itemref',
	'itemscope',
	'itemtype',
	'lang',
	'nonce',
	'part',
	'popover',
	'role',
	'slot',
	'spellcheck',
	'style',
	'tabindex',
	'title',
	'translate',
] );

export function wireCapturedDialogs(
	html: string,
	states: CapturedDialogInteraction[],
	initialDialogs: CapturedInitialDialog[] = []
): string {
	const captured = states.filter( ( state ) => state.status === 'captured' && state.dialog?.html );
	if ( captured.length === 0 && initialDialogs.length === 0 ) return html;
	const $ = cheerio.load( html );
	let wired = 0;
	for ( const state of captured ) {
		removeCapturedDialog( $, state.dialog?.selector );
		const triggers = findTriggers( $, state.trigger );
		triggers.each( ( _, element ) => {
			const trigger = $( element );
			if ( trigger.closest( 'details.dla-disclosure' ).length ) return;
			const summary = $( '<summary></summary>' );
			const label = trigger.attr( 'aria-label' ) || normalizedText( trigger.text() );
			const attrs = trigger.attr() ?? {};
			for ( const [ name, value ] of Object.entries( attrs ) ) {
				if (
					! GLOBAL_ATTRIBUTES.has( name ) &&
					! name.startsWith( 'aria-' ) &&
					! name.startsWith( 'data-' )
				)
					continue;
				summary.attr( name, value );
			}
			if ( label ) summary.attr( 'data-dla-disclosure-label', label );
			summary.html( trigger.html() ?? '' );
			const panel = $( '<div class="dla-dialog" role="dialog" aria-modal="true"></div>' );
			if ( state.dialog?.ariaLabel ) panel.attr( 'aria-label', state.dialog.ariaLabel );
			panel.html( state.dialog!.html );
			const details = $( '<details class="dla-disclosure"></details>' );
			details.append( summary, panel );
			trigger.replaceWith( details );
			wired++;
		} );
	}
	for ( const state of initialDialogs ) {
		if ( state.status !== 'captured' || !state.dismissal?.verified || state.dialog.htmlTruncated ) continue;
		const panel = $( '<div class="dla-dialog" role="dialog" aria-modal="true"></div>' );
		if ( state.dialog.ariaLabel ) panel.attr( 'aria-label', state.dialog.ariaLabel );
		panel.html( state.dialog.html );
		const close = findCloseControl( $, panel as cheerio.Cheerio< Element >, state.dismissal.control );
		if ( !close.length ) continue;
		const summary = $( '<summary></summary>' );
		for ( const [ name, value ] of Object.entries( close.attr() ?? {} ) ) {
			if ( name !== 'type' && name !== 'id' ) summary.attr( name, value );
		}
		summary.html( close.html() ?? state.dismissal.control.label ?? 'Close' );
		close.remove();
		const details = $( '<details class="dla-disclosure dla-initial-dialog" open></details>' );
		details.append( summary, panel );
		$( 'body' ).append( details );
		wired++;
	}
	if ( wired > 0 ) {
		if ( $( 'style[data-dla-disclosure]' ).length === 0 ) {
			$( 'head' ).append( `<style data-dla-disclosure="true">${ DISCLOSURE_CSS }</style>` );
		}
		if ( $( 'script[data-dla-disclosure-runtime]' ).length === 0 ) {
			$( 'head' ).append(
				`<script data-dla-disclosure-runtime="true">${ DISCLOSURE_RUNTIME }</script>`
			);
		}
	}
	return $.html();
}

function removeCapturedDialog( $: cheerio.CheerioAPI, selector: string | undefined ): void {
	if ( ! selector ) return;
	try {
		$( selector ).not( 'details.dla-disclosure *' ).remove();
	} catch {
		// Invalid source selectors cannot safely identify a node to remove.
	}
}

function findCloseControl(
	$: cheerio.CheerioAPI,
	dialog: cheerio.Cheerio< Element >,
	control: NonNullable< CapturedInitialDialog[ 'dismissal' ] >[ 'control' ]
) {
	if ( control.selector.startsWith( '#' ) ) {
		const byId = dialog.find( control.selector ).first();
		if ( byId.length ) return byId;
	}
	const label = ( control.label ?? '' ).replace( /\s+/g, ' ' ).trim().toLowerCase();
	return dialog
		.find(
			'[aria-label*="close" i],[title*="close" i],button[class*="close" i],[data-dismiss],[data-testid*="close" i]'
		)
		.filter( ( _, element ) => {
			if ( element.tagName !== control.tag ) return false;
			if ( !label ) return true;
			const text = ( $( element ).attr( 'aria-label' ) || $( element ).text() )
				.replace( /\s+/g, ' ' )
				.trim()
				.toLowerCase();
			return text === label;
		} )
		.first();
}

function findTriggers(
	$: cheerio.CheerioAPI,
	trigger: CapturedDialogInteraction[ 'trigger' ]
) {
	if ( trigger.id ) {
		const byId = $( `#${ cssEscape( trigger.id ) }` );
		if ( byId.length ) return byId;
	}
	const label = ( trigger.label ?? '' ).replace( /\s+/g, ' ' ).trim().toLowerCase();
	if ( ! label ) return $( [] );
	return $( 'button,summary,a,[role="button"]' ).filter( ( _, element ) => {
		const text = ( $( element ).attr( 'aria-label' ) || $( element ).text() )
			.replace( /\s+/g, ' ' )
			.trim()
			.toLowerCase();
		if ( ! text ) return false;
		return text.includes( label ) || label.includes( text );
	} );
}

function cssEscape( value: string ): string {
	return value.replace( /([^a-zA-Z0-9_-])/g, '\\$1' );
}

function normalizedText( value: string ): string {
	return value.replace( /\s+/g, ' ' ).trim();
}
