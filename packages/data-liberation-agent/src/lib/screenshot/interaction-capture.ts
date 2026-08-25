import type { Page } from 'playwright';

export const INTERACTION_STATES_SCHEMA = 'data-liberation/interaction-states/v1';

const MAX_TRIGGERS = 8;
const MAX_DIALOG_HTML_BYTES = 64 * 1024;
const DIALOG_WAIT_MS = 2_000;

export interface CapturedDialogInteraction {
	status: 'captured' | 'no-dialog' | 'click-failed';
	trigger: {
		selector: string;
		tag: string;
		id?: string;
		role?: string;
		ariaHaspopup: string;
		ariaControls?: string;
		dataBindings: Record< string, string >;
	};
	dialog?: {
		selector: string;
		tag: string;
		id?: string;
		role?: string;
		ariaModal: boolean;
		ariaLabel?: string;
		html: string;
		htmlBytes: number;
		htmlTruncated: boolean;
	};
	error?: string;
}

export interface InteractionStatesReport {
	schema: typeof INTERACTION_STATES_SCHEMA;
	sourceUrl: string;
	viewport: { width: number; height: number };
	capturedAt: string;
	states: CapturedDialogInteraction[];
}

interface TriggerDescriptor {
	index: number;
	selector: string;
	probeSelector: string;
	tag: string;
	id?: string;
	role?: string;
	ariaHaspopup: string;
	ariaControls?: string;
	dataBindings: Record< string, string >;
}

interface DialogDescriptor {
	selector: string;
	tag: string;
	id?: string;
	role?: string;
	ariaModal: boolean;
	ariaLabel?: string;
	html: string;
}

/** Capture user-triggered dialogs after all baseline page artifacts are complete. */
export async function captureTriggeredDialogs(
	page: Page,
	sourceUrl: string
): Promise< InteractionStatesReport > {
	const viewport = page.viewportSize() ?? { width: 0, height: 0 };
	const triggers = await page.evaluate( ( limit: number ) => {
		const visible = ( element: Element ): boolean => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle( element );
			return (
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				Number.parseFloat( style.opacity || '1' ) > 0.1
			);
		};
		const cssEscape = ( value: string ) =>
			globalThis.CSS?.escape ? globalThis.CSS.escape( value ) : value.replace( /[^a-zA-Z0-9_-]/g, '\\$&' );
		const sourceSelector = ( element: Element ): string => {
			if ( element.id ) return `#${ cssEscape( element.id ) }`;
			const parts: string[] = [];
			for ( let node: Element | null = element; node && node !== document.body; node = node.parentElement ) {
				const tag = node.tagName.toLowerCase();
				const siblings = node.parentElement
					? Array.from( node.parentElement.children ).filter( ( sibling ) => sibling.tagName === node!.tagName )
					: [];
				parts.unshift( siblings.length > 1 ? `${ tag }:nth-of-type(${ siblings.indexOf( node ) + 1 })` : tag );
			}
			return `body > ${ parts.join( ' > ' ) }`;
		};
		const probeSelector = ( element: Element, index: number ): string => {
			if ( element.id ) return `#${ cssEscape( element.id ) }`;
			element.setAttribute( 'data-lib-interaction-trigger', String( index ) );
			return `[data-lib-interaction-trigger="${ index }"]`;
		};
		const candidates = Array.from(
			document.querySelectorAll( 'button[aria-haspopup],a[aria-haspopup],[role="button"][aria-haspopup]' )
		).filter( ( element ) => {
			const popup = ( element.getAttribute( 'aria-haspopup' ) ?? '' ).toLowerCase();
			if ( popup !== 'dialog' ) return false;
			if ( element.getAttribute( 'aria-disabled' ) === 'true' ) return false;
			const hasBinding = Boolean( element.getAttribute( 'aria-controls' ) ) || Array.from( element.attributes ).some(
				( attribute ) => /^data-(?:popup|modal|dialog)(?:id|target)?$/i.test( attribute.name ) && Boolean( attribute.value )
			);
			const href = element.tagName === 'A' ? ( element.getAttribute( 'href' ) ?? '' ).trim() : '';
			if ( href && href !== '#' && ! href.startsWith( '#' ) && ! hasBinding ) return false;
			return visible( element );
		} );

		return candidates.slice( 0, limit ).map( ( element, index ) => {
			const dataBindings: Record< string, string > = {};
			for ( const attribute of Array.from( element.attributes ) ) {
				if ( /^data-(?:popup|modal|dialog)(?:id|target)?$/i.test( attribute.name ) && attribute.value ) {
					dataBindings[ attribute.name.toLowerCase() ] = attribute.value;
				}
			}
			return {
				index,
				selector: sourceSelector( element ),
				probeSelector: probeSelector( element, index ),
				tag: element.tagName.toLowerCase(),
				...( element.id ? { id: element.id } : {} ),
				...( element.getAttribute( 'role' ) ? { role: element.getAttribute( 'role' )! } : {} ),
				ariaHaspopup: element.getAttribute( 'aria-haspopup' ) ?? '',
				...( element.getAttribute( 'aria-controls' )
					? { ariaControls: element.getAttribute( 'aria-controls' )! }
					: {} ),
				dataBindings,
			};
		} );
	}, MAX_TRIGGERS ) as TriggerDescriptor[];

	const states: CapturedDialogInteraction[] = [];
	for ( const trigger of triggers ) {
		const before = await visibleDialogSelectors( page );
		try {
			await page.locator( trigger.probeSelector ).first().click( { timeout: DIALOG_WAIT_MS } );
		} catch ( error ) {
			states.push( {
				status: 'click-failed',
				trigger: triggerRecord( trigger ),
				error: boundedError( error ),
			} );
			continue;
		}

		let dialog: DialogDescriptor | undefined;
		const deadline = Date.now() + DIALOG_WAIT_MS;
		do {
			dialog = await firstNewVisibleDialog( page, before );
			if ( dialog ) break;
			await page.waitForTimeout( 100 );
		} while ( Date.now() < deadline );

		if ( ! dialog ) {
			states.push( { status: 'no-dialog', trigger: triggerRecord( trigger ) } );
			await page.keyboard.press( 'Escape' ).catch( () => undefined );
			continue;
		}
		await waitForDialogContentStable( page, dialog.selector );
		dialog = ( await snapshotDialog( page, dialog.selector ) ) ?? dialog;

		const bounded = boundHtml( dialog.html );
		states.push( {
			status: 'captured',
			trigger: triggerRecord( trigger ),
			dialog: {
				selector: dialog.selector,
				tag: dialog.tag,
				...( dialog.id ? { id: dialog.id } : {} ),
				...( dialog.role ? { role: dialog.role } : {} ),
				ariaModal: dialog.ariaModal,
				...( dialog.ariaLabel ? { ariaLabel: dialog.ariaLabel } : {} ),
				html: bounded.html,
				htmlBytes: bounded.bytes,
				htmlTruncated: bounded.truncated,
			},
		} );

		await closeCapturedDialog( page, dialog.selector );
	}

	await page.evaluate( () => {
		for ( const element of document.querySelectorAll( '[data-lib-interaction-trigger]' ) ) {
			element.removeAttribute( 'data-lib-interaction-trigger' );
		}
		for ( const element of document.querySelectorAll( '[data-lib-interaction-dialog]' ) ) {
			element.removeAttribute( 'data-lib-interaction-dialog' );
		}
	} );

	return {
		schema: INTERACTION_STATES_SCHEMA,
		sourceUrl,
		viewport,
		capturedAt: new Date().toISOString(),
		states,
	};
}

function triggerRecord( trigger: TriggerDescriptor ): CapturedDialogInteraction['trigger'] {
	return {
		selector: trigger.selector,
		tag: trigger.tag,
		...( trigger.id ? { id: trigger.id } : {} ),
		...( trigger.role ? { role: trigger.role } : {} ),
		ariaHaspopup: trigger.ariaHaspopup,
		...( trigger.ariaControls ? { ariaControls: trigger.ariaControls } : {} ),
		dataBindings: trigger.dataBindings,
	};
}

async function visibleDialogSelectors( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const visible = ( element: Element ): boolean => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle( element );
			return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat( style.opacity || '1' ) > 0.1;
		};
		const selector = ( element: Element, index: number ): string => {
			if ( element.id ) {
				const id = globalThis.CSS?.escape ? globalThis.CSS.escape( element.id ) : element.id.replace( /[^a-zA-Z0-9_-]/g, '\\$&' );
				return `#${ id }`;
			}
			return `dialog-candidate:${ index }`;
		};
		return Array.from( document.querySelectorAll( 'dialog,[role="dialog"],[aria-modal="true"]' ) )
			.filter( visible )
			.map( selector );
	} );
}

async function firstNewVisibleDialog(
	page: Page,
	before: string[]
): Promise< DialogDescriptor | undefined > {
	return page.evaluate( ( existing: string[] ) => {
		const visible = ( element: Element ): boolean => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle( element );
			return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat( style.opacity || '1' ) > 0.1;
		};
		const selector = ( element: Element, index: number ): string => {
			if ( element.id ) {
				const id = globalThis.CSS?.escape ? globalThis.CSS.escape( element.id ) : element.id.replace( /[^a-zA-Z0-9_-]/g, '\\$&' );
				return `#${ id }`;
			}
			return `dialog-candidate:${ index }`;
		};
		const candidates = Array.from(
			document.querySelectorAll( 'dialog,[role="dialog"],[aria-modal="true"]' )
		);
		const dialog = candidates.find( ( element, index ) => visible( element ) && ! existing.includes( selector( element, index ) ) );
		if ( ! dialog ) return undefined;
		const dialogSelector = dialog.id ? selector( dialog, candidates.indexOf( dialog ) ) : '[data-lib-interaction-dialog="captured"]';
		if ( ! dialog.id ) dialog.setAttribute( 'data-lib-interaction-dialog', 'captured' );
		const clone = dialog.cloneNode( true ) as Element;
		clone.removeAttribute( 'data-lib-interaction-dialog' );
		for ( const unsafe of Array.from( clone.querySelectorAll( 'script,style,noscript,iframe' ) ) ) unsafe.remove();
		for ( const element of [ clone, ...Array.from( clone.querySelectorAll( '*' ) ) ] ) {
			for ( const attribute of Array.from( element.attributes ) ) {
				if ( /^on/i.test( attribute.name ) ) element.removeAttribute( attribute.name );
			}
		}
		return {
			selector: dialogSelector,
			tag: dialog.tagName.toLowerCase(),
			...( dialog.id ? { id: dialog.id } : {} ),
			...( dialog.getAttribute( 'role' ) ? { role: dialog.getAttribute( 'role' )! } : {} ),
			ariaModal: dialog.getAttribute( 'aria-modal' ) === 'true',
			...( dialog.getAttribute( 'aria-label' )
				? { ariaLabel: dialog.getAttribute( 'aria-label' )! }
				: {} ),
			html: clone.outerHTML,
		};
	}, before ) as Promise< DialogDescriptor | undefined >;
}

async function closeCapturedDialog( page: Page, selector: string ): Promise< void > {
	await page.keyboard.press( 'Escape' ).catch( () => undefined );
	await page.waitForTimeout( 100 );
	const stillVisible = await page
		.locator( selector )
		.first()
		.isVisible()
		.catch( () => false );
	if ( ! stillVisible ) return;
	const close = page
		.locator( selector )
		.first()
		.locator(
			'[aria-label*="close" i],[title*="close" i],button[class*="close" i],[data-dismiss],[data-testid*="close" i]'
		)
		.first();
	if ( await close.isVisible().catch( () => false ) ) {
		await close.click( { timeout: 1_000 } ).catch( () => undefined );
	}
}

async function waitForDialogContentStable( page: Page, selector: string ): Promise< void > {
	let previous = -1;
	let stableSamples = 0;
	const deadline = Date.now() + DIALOG_WAIT_MS;
	while ( Date.now() < deadline ) {
		await page.waitForTimeout( 150 );
		const bytes = await page
			.locator( selector )
			.first()
			.evaluate( ( element ) => new TextEncoder().encode( element.outerHTML ).length )
			.catch( () => -1 );
		if ( bytes > 0 && bytes === previous ) stableSamples++;
		else stableSamples = 0;
		if ( stableSamples >= 2 ) return;
		previous = bytes;
	}
}

async function snapshotDialog( page: Page, selector: string ): Promise< DialogDescriptor | undefined > {
	return page.locator( selector ).first().evaluate( ( dialog, capturedSelector ) => {
		const clone = dialog.cloneNode( true ) as Element;
		clone.removeAttribute( 'data-lib-interaction-dialog' );
		for ( const unsafe of Array.from( clone.querySelectorAll( 'script,style,noscript,iframe' ) ) ) unsafe.remove();
		for ( const element of [ clone, ...Array.from( clone.querySelectorAll( '*' ) ) ] ) {
			for ( const attribute of Array.from( element.attributes ) ) {
				if ( /^on/i.test( attribute.name ) ) element.removeAttribute( attribute.name );
			}
		}
		return {
			selector: capturedSelector,
			tag: dialog.tagName.toLowerCase(),
			...( dialog.id ? { id: dialog.id } : {} ),
			...( dialog.getAttribute( 'role' ) ? { role: dialog.getAttribute( 'role' )! } : {} ),
			ariaModal: dialog.getAttribute( 'aria-modal' ) === 'true',
			...( dialog.getAttribute( 'aria-label' )
				? { ariaLabel: dialog.getAttribute( 'aria-label' )! }
				: {} ),
			html: clone.outerHTML,
		};
	}, selector ).catch( () => undefined );
}

function boundHtml( html: string ): { html: string; bytes: number; truncated: boolean } {
	const bytes = Buffer.byteLength( html );
	if ( bytes <= MAX_DIALOG_HTML_BYTES ) return { html, bytes, truncated: false };
	const bounded = Buffer.from( html ).subarray( 0, MAX_DIALOG_HTML_BYTES ).toString();
	return { html: bounded, bytes, truncated: true };
}

function boundedError( error: unknown ): string {
	return ( error instanceof Error ? error.message : String( error ) ).slice( 0, 500 );
}
