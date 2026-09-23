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
const LISTBOX_RUNTIME = `(function(){function all(selector,root){return Array.prototype.slice.call((root||document).querySelectorAll(selector));}function panel(trigger){var key=trigger.getAttribute('data-dla-listbox-trigger');return key===null?null:document.querySelector('[data-dla-listbox-panel="'+key+'"]');}function options(surface){return surface?all('[role="option"]',surface):[];}function close(trigger){var surface=panel(trigger);if(!surface)return;surface.hidden=true;trigger.setAttribute('aria-expanded','false');}function open(trigger){var surface=panel(trigger);if(!surface)return;surface.hidden=false;trigger.setAttribute('aria-expanded','true');}function select(trigger,option){var surface=panel(trigger);if(!surface)return;options(surface).forEach(function(item){item.setAttribute('aria-selected',item===option?'true':'false');});var label=option.getAttribute('aria-label')||option.textContent||'';trigger.textContent=label.trim();if(option.id)trigger.setAttribute('aria-activedescendant',option.id);close(trigger);trigger.focus();}function move(trigger,option,delta){var surface=panel(trigger),items=options(surface);if(!surface||!items.length)return;var index=items.indexOf(option);var next=items[Math.max(0,Math.min(items.length-1,index+delta))]||items[0];items.forEach(function(item){item.tabIndex=item===next?0:-1;});next.focus();}function ready(){all('[data-dla-listbox-trigger]').forEach(function(trigger){var surface=panel(trigger);if(!surface)return;trigger.setAttribute('type','button');options(surface).forEach(function(option){option.tabIndex=-1;option.addEventListener('click',function(){select(trigger,option);});option.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();close(trigger);trigger.focus();}else if(event.key==='ArrowDown'){event.preventDefault();move(trigger,option,1);}else if(event.key==='ArrowUp'){event.preventDefault();move(trigger,option,-1);}else if(event.key==='Enter'||event.key===' '){event.preventDefault();select(trigger,option);}});});trigger.addEventListener('click',function(){if(trigger.getAttribute('aria-expanded')==='true')close(trigger);else open(trigger);});trigger.addEventListener('keydown',function(event){if(event.key==='Escape'){if(trigger.getAttribute('aria-expanded')==='true'){event.preventDefault();close(trigger);}return;}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(trigger);move(trigger,options(panel(trigger))[0],event.key==='ArrowDown'?1:-1);}else if(event.key==='Enter'||event.key===' '){event.preventDefault();if(trigger.getAttribute('aria-expanded')!=='true')open(trigger);}});});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();})();`;

const CHOICE_GROUP_RUNTIME = `(function(){var configs=__DLA_CHOICE_CONFIG__;function configFor(group){return configs[group.getAttribute('data-dla-choice-group')]||null;}function replay(group,index){var config=configFor(group),html=config&&config.transitions[String(index)];if(!html)return;var holder=document.createElement('div');holder.innerHTML=html;var replacement=holder.firstElementChild;if(!replacement)return;var key=group.getAttribute('data-dla-choice-group');replacement.setAttribute('data-dla-choice-group',key);group.replaceWith(replacement);var next=replacement.querySelector('[data-dla-choice-index="'+index+'"]');if(next&&typeof next.focus==='function')next.focus();}function activate(event){var target=event.target;if(!(target instanceof Element))return;var choice=target.closest('[data-dla-choice-index]');var group=choice&&choice.closest('[data-dla-choice-group]');if(!choice||!group)return;var index=choice.getAttribute('data-dla-choice-index');if(index===null)return;if(event.type==='keydown'){if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();}replay(group,index);}function ready(){document.addEventListener('click',activate);document.addEventListener('keydown',activate);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();})();`;

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
	// Disclosure/accordion panels (`kind === 'disclosure'`) are restored in
	// place, in the live DOM, before the page's HTML is ever serialized (see
	// `hydrateDisclosureContent`) — their content is already inline in `html`
	// here. Selectable-set states (`kind === 'selectable-set'`) are evidence of
	// a shared region. Choice-group states are the exception: their own group
	// markup is the observed transition and can be replayed without a source
	// runtime. Neither shape is a popup, so only dialog/menu-kind states are
	// wired as disclosures.
	const captured = states.filter(
		( state ) =>
			state.status === 'captured' &&
			state.dialog?.html &&
			( state.kind === undefined || state.kind === 'dialog' )
	);
	const choiceStates = states.filter(
		( state ) =>
			state.status === 'captured' &&
			state.kind === 'choice-group' &&
			state.choiceGroup &&
			state.choiceGroup.replay === 'activation-determined' &&
			state.choiceGroup.restoration === 'verified' &&
			state.choiceGroup.coverage === 'complete' &&
			! state.choiceGroup.transition.htmlTruncated
	);
	if ( captured.length === 0 && choiceStates.length === 0 && initialDialogs.length === 0 ) return html;
	const $ = cheerio.load( html );
	let wired = 0;
	let listboxes = 0;
	const choiceConfigs: Array< { transitions: Record< string, string > } > = [];
	const choiceGroups = new Map< string, NonNullable< CapturedDialogInteraction[ 'choiceGroup' ] >[] >();
	for ( const state of choiceStates ) {
		const group = state.choiceGroup!;
		const key = `${ group.group.selector }|${ group.group.id ?? '' }`;
		const existing = choiceGroups.get( key ) ?? [];
		existing.push( group );
		choiceGroups.set( key, existing );
	}
	for ( const groups of choiceGroups.values() ) {
		const descriptor = groups[ 0 ]!;
		const key = String( choiceConfigs.length );
		const transitions: Record< string, string > = {};
		for ( const group of groups ) transitions[ String( group.transition.selectedIndex ) ] = group.transition.html;
		const roots = selectByCapturedSelector( $, descriptor.group.selector, descriptor.group.tag );
		roots.each( ( _, element ) => {
			const root = $( element );
			root.attr( 'data-dla-choice-group', key );
			const choices = descriptor.choices;
			const candidates = root
				.find( choices[ 0 ]?.tag || '*' )
				.filter( ( __, candidate ) => ( $( candidate ).attr( 'role' ) || '' ) === ( choices[ 0 ]?.role || '' ) )
				.toArray();
			candidates.slice( 0, choices.length ).forEach( ( candidate, index ) =>
				$( candidate ).attr( 'data-dla-choice-index', String( index ) )
			);
		} );
		if ( roots.length > 0 && Object.keys( transitions ).length > 0 ) choiceConfigs.push( { transitions } );
	}
	for ( const state of captured ) {
		removeCapturedDialog( $, state.dialog?.selector );
		const triggers = findTriggers( $, state.trigger );
		triggers.each( ( _, element ) => {
			const trigger = $( element );
			if ( trigger.closest( 'details.dla-disclosure' ).length || trigger.attr( 'data-dla-listbox-trigger' ) ) return;
			if ( state.dialog?.role?.toLowerCase() === 'listbox' || state.trigger.ariaHaspopup.toLowerCase() === 'listbox' ) {
				const key = String( listboxes++ );
				const panel = $( '<div hidden></div>' );
				panel.attr( 'data-dla-listbox-panel', key ).html( state.dialog!.html );
				trigger.attr( 'data-dla-listbox-trigger', key ).attr( 'type', 'button' ).after( panel );
				trigger.attr( 'aria-expanded', 'false' );
				return;
			}
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
	if ( listboxes > 0 && $( 'script[data-dla-listbox-runtime]' ).length === 0 )
		$( 'head' ).append( `<script data-dla-listbox-runtime="true">${ LISTBOX_RUNTIME }</script>` );
	if ( choiceConfigs.length > 0 && $( 'script[data-dla-choice-runtime]' ).length === 0 ) {
		const config = JSON.stringify( choiceConfigs ).replace( /</g, '\\u003c' );
		$( 'head' ).append(
			`<script data-dla-choice-runtime="true">${ CHOICE_GROUP_RUNTIME.replace( '__DLA_CHOICE_CONFIG__', config ) }</script>`
		);
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
	const bySelector = selectByCapturedSelector( $, trigger.selector, trigger.tag );
	if ( bySelector.length ) return bySelector;
	const label = ( trigger.label ?? '' ).replace( /\s+/g, ' ' ).trim().toLowerCase();
	if ( ! label ) return $( [] );
	return $( 'button,summary,a,[role="button"]' ).filter( ( _, element ) => {
		if ( trigger.tag && element.tagName !== trigger.tag ) return false;
		if ( isNavigatingAnchor( $, element ) ) return false;
		const text = ( $( element ).attr( 'aria-label' ) || $( element ).text() )
			.replace( /\s+/g, ' ' )
			.trim()
			.toLowerCase();
		if ( ! text ) return false;
		return text.includes( label ) || label.includes( text );
	} );
}

function selectByCapturedSelector(
	$: cheerio.CheerioAPI,
	selector: string | undefined,
	tag: string | undefined
) {
	if ( ! selector ) return $( [] );
	try {
		const matches = $( selector );
		if ( ! tag ) return matches;
		return matches.filter( ( _, element ) => ( element as Element ).tagName === tag );
	} catch {
		return $( [] );
	}
}

function isNavigatingAnchor( $: cheerio.CheerioAPI, element: Element ): boolean {
	if ( element.tagName !== 'a' ) return false;
	const href = ( $( element ).attr( 'href' ) ?? '' ).trim();
	if ( ! href || href === '#' || href.startsWith( '#' ) ) return false;
	const scheme = href.split( ':', 1 )[ 0 ]!.toLowerCase();
	return scheme !== 'javascript';
}

function cssEscape( value: string ): string {
	return value.replace( /([^a-zA-Z0-9_-])/g, '\\$1' );
}

function normalizedText( value: string ): string {
	return value.replace( /\s+/g, ' ' ).trim();
}
