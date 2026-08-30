import * as cheerio from 'cheerio';
import type { CapturedDialogInteraction } from './screenshot/interaction-capture.js';

const DISCLOSURE_CSS =
	'details.dla-disclosure>summary{list-style:none;cursor:pointer;display:inline-block}' +
	'details.dla-disclosure>summary::-webkit-details-marker{display:none}' +
	'details.dla-disclosure:not([open])>.dla-dialog{display:none!important}' +
	'details.dla-disclosure[open]>.dla-dialog{display:block;position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#fff}';

export function wireCapturedDialogs( html: string, states: CapturedDialogInteraction[] ): string {
	const captured = states.filter( ( state ) => state.status === 'captured' && state.dialog?.html );
	if ( captured.length === 0 ) return html;
	const $ = cheerio.load( html );
	let wired = 0;
	for ( const state of captured ) {
		const triggers = findTriggers( $, state.trigger );
		triggers.each( ( _, element ) => {
			const trigger = $( element );
			if ( trigger.closest( 'details.dla-disclosure' ).length ) return;
			const summary = $( '<summary></summary>' );
			const attrs = trigger.attr() ?? {};
			for ( const [ name, value ] of Object.entries( attrs ) ) {
				if ( name === 'type' ) continue;
				summary.attr( name, value );
			}
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
	if ( wired > 0 && $( 'style[data-dla-disclosure]' ).length === 0 ) {
		$( 'head' ).append( `<style data-dla-disclosure="true">${ DISCLOSURE_CSS }</style>` );
	}
	return $.html();
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
