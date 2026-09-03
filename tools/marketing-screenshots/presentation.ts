import type { ScenarioId } from './presets.ts';
import type { Page } from '@playwright/test';

const COMPOSER_TEXTAREA_SELECTOR = '[data-session-composer] textarea:not([disabled])';
const MESSAGE_SELECTOR = '[data-message-text]';

export const COMPOSER_FOCUS_STATES = [ 'focused', 'blurred' ] as const;
export type ComposerFocusState = ( typeof COMPOSER_FOCUS_STATES )[ number ];

export const CONVERSATION_ALIGNMENTS = [ 'start', 'center', 'end', 'nearest' ] as const;
export type ConversationAlignment = ( typeof CONVERSATION_ALIGNMENTS )[ number ];

export const CONVERSATION_OCCURRENCES = [ 'first', 'last' ] as const;
export type ConversationOccurrence = ( typeof CONVERSATION_OCCURRENCES )[ number ];

export type ConversationAnchor =
	| { kind: 'edge'; edge: 'start' | 'end' }
	| { kind: 'message'; position: 'first' | 'last' }
	| { kind: 'message-text'; text: string };

export interface PresentationOverrides {
	composerText?: string;
	composerFocus?: ComposerFocusState;
	conversationAnchor?: ConversationAnchor;
	conversationAlignment?: ConversationAlignment;
	conversationOccurrence?: ConversationOccurrence;
}

export type CapturePresentationAction =
	| { kind: 'open-selective-pull' }
	| { kind: 'show-responsive-comparison' }
	| { kind: 'set-local-site-url-label'; label: string };

export interface CapturePresentation extends PresentationOverrides {
	actions?: readonly CapturePresentationAction[];
}

export type AppliedCapturePresentationAction =
	| {
			kind: 'open-selective-pull';
			dialogSubmitVisible: true;
			selectedItems: readonly [ 'Database' ];
			treeItemCount: number;
	  }
	| {
			kind: 'show-responsive-comparison';
			menuDismissed: true;
			fullscreen: true;
			iframeCount: 2;
	  }
	| {
			kind: 'set-local-site-url-label';
			label: string;
			originalLabel: string;
	  };

export interface AppliedCapturePresentation {
	actions: AppliedCapturePresentationAction[];
	composer: {
		text: string;
		focus: ComposerFocusState;
	} | null;
	conversation: {
		anchor: ConversationAnchor;
		alignment?: ConversationAlignment;
		occurrence?: ConversationOccurrence;
		matchedMessageText: string | null;
		scrollTop: number;
		scrollHeight: number;
		clientHeight: number;
	} | null;
}

/**
 * Tool-owned presentation defaults run after the UI's readiness contract. Keep
 * them here so marketing framing can evolve without adding capture concerns to
 * production UI code. The completed-agent scenario already scrolls to the end;
 * declaring that intent makes the final position deterministic after readiness.
 */
const SCENARIO_PRESENTATION_DEFAULTS: Partial< Record< ScenarioId, CapturePresentation > > = {
	'agent-new-session': {
		composerText:
			'Create a homepage for Meridian Coffee with a bold editorial hero, featured roasts, and a mobile-friendly menu.',
		composerFocus: 'focused',
	},
	'agent-working-preview': {
		conversationAnchor: { kind: 'edge', edge: 'end' },
	},
	'agent-complete-preview': {
		conversationAnchor: { kind: 'edge', edge: 'end' },
	},
	'agent-long-conversation': {
		conversationAnchor: { kind: 'edge', edge: 'end' },
	},
	'connected-site-controls': {
		actions: [ { kind: 'set-local-site-url-label', label: 'meridian.local' } ],
	},
	'selective-sync': {
		actions: [ { kind: 'open-selective-pull' } ],
	},
	'responsive-preview': {
		actions: [ { kind: 'show-responsive-comparison' } ],
	},
};

export function parseComposerFocus( value: string ): ComposerFocusState {
	if ( ! COMPOSER_FOCUS_STATES.includes( value as ComposerFocusState ) ) {
		throw new Error( '--composer-focus must be either focused or blurred.' );
	}
	return value as ComposerFocusState;
}

export function parseConversationAlignment( value: string ): ConversationAlignment {
	if ( ! CONVERSATION_ALIGNMENTS.includes( value as ConversationAlignment ) ) {
		throw new Error( '--conversation-align must be start, center, end, or nearest.' );
	}
	return value as ConversationAlignment;
}

export function parseConversationOccurrence( value: string ): ConversationOccurrence {
	if ( ! CONVERSATION_OCCURRENCES.includes( value as ConversationOccurrence ) ) {
		throw new Error( '--conversation-occurrence must be either first or last.' );
	}
	return value as ConversationOccurrence;
}

export function parseConversationAnchor( value: string ): ConversationAnchor {
	switch ( value ) {
		case 'start':
		case 'end':
			return { kind: 'edge', edge: value };
		case 'first-message':
			return { kind: 'message', position: 'first' };
		case 'last-message':
			return { kind: 'message', position: 'last' };
	}

	const messagePrefix = 'message:';
	if ( value.startsWith( messagePrefix ) && value.slice( messagePrefix.length ).trim() ) {
		return { kind: 'message-text', text: value.slice( messagePrefix.length ) };
	}

	throw new Error(
		'--conversation-anchor must be start, end, first-message, last-message, or message:<text>.'
	);
}

export function resolveCapturePresentation(
	scenario: ScenarioId,
	overrides: PresentationOverrides
): CapturePresentation {
	const presentation: CapturePresentation = {
		...SCENARIO_PRESENTATION_DEFAULTS[ scenario ],
		...overrides,
	};

	if ( presentation.composerText !== undefined && presentation.composerFocus === undefined ) {
		presentation.composerFocus = 'blurred';
	}

	const anchor = presentation.conversationAnchor;
	if ( ! anchor ) {
		if ( presentation.conversationAlignment !== undefined ) {
			throw new Error( '--conversation-align requires --conversation-anchor.' );
		}
		if ( presentation.conversationOccurrence !== undefined ) {
			throw new Error( '--conversation-occurrence requires a message:<text> anchor.' );
		}
		return presentation;
	}

	if ( anchor.kind === 'edge' ) {
		if ( presentation.conversationAlignment !== undefined ) {
			throw new Error( '--conversation-align cannot be used with a start or end anchor.' );
		}
		if ( presentation.conversationOccurrence !== undefined ) {
			throw new Error( '--conversation-occurrence requires a message:<text> anchor.' );
		}
		return presentation;
	}

	presentation.conversationAlignment ??= 'center';
	if ( anchor.kind === 'message-text' ) {
		presentation.conversationOccurrence ??= 'first';
	} else if ( presentation.conversationOccurrence !== undefined ) {
		throw new Error( '--conversation-occurrence requires a message:<text> anchor.' );
	}

	return presentation;
}

export async function applyCapturePresentation(
	page: Page,
	presentation: CapturePresentation,
	timeoutMs: number
): Promise< AppliedCapturePresentation > {
	const actions = await applyPresentationActions( page, presentation.actions ?? [], timeoutMs );
	await settlePaint( page );
	const composer = await applyComposerPresentation( page, presentation, timeoutMs );
	await settlePaint( page );
	if ( presentation.composerFocus !== 'focused' ) {
		await clearIncidentalFocus( page );
		await settlePaint( page );
	}
	const conversation = await applyConversationPresentation( page, presentation, timeoutMs );
	await settlePaint( page );

	return { actions, composer, conversation };
}

async function clearIncidentalFocus( page: Page ): Promise< void > {
	await page.mouse.move( 0, 0 );
	await page.evaluate( () => {
		if ( document.activeElement instanceof HTMLElement ) {
			document.activeElement.blur();
		}
	} );
}

async function applyPresentationActions(
	page: Page,
	actions: readonly CapturePresentationAction[],
	timeoutMs: number
): Promise< AppliedCapturePresentationAction[] > {
	const applied: AppliedCapturePresentationAction[] = [];
	for ( const action of actions ) {
		switch ( action.kind ) {
			case 'open-selective-pull':
				applied.push( await openSelectivePull( page, timeoutMs ) );
				break;
			case 'show-responsive-comparison':
				applied.push( await showResponsiveComparison( page, timeoutMs ) );
				break;
			case 'set-local-site-url-label':
				applied.push( await setLocalSiteUrlLabel( page, action.label, timeoutMs ) );
				break;
		}
	}
	return applied;
}

async function setLocalSiteUrlLabel(
	page: Page,
	label: string,
	timeoutMs: number
): Promise< AppliedCapturePresentationAction > {
	const link = page.getByRole( 'button', {
		name: 'Open Studio site in your browser',
		exact: true,
	} );
	await link.waitFor( { state: 'visible', timeout: timeoutMs } );
	const labelElement = link.locator( 'span' ).first();
	const originalLabel = ( await labelElement.textContent() )?.trim();
	if ( ! originalLabel ) {
		throw new Error( 'The local Studio site URL did not have a visible label.' );
	}
	await labelElement.evaluate( ( node, nextLabel ) => {
		node.textContent = nextLabel;
	}, label );
	await page.waitForFunction(
		( { selector, expectedLabel } ) =>
			document.querySelector( selector )?.textContent?.trim() === expectedLabel,
		{
			selector: 'button[aria-label="Open Studio site in your browser"] span',
			expectedLabel: label,
		},
		{ timeout: timeoutMs }
	);

	return { kind: 'set-local-site-url-label', label, originalLabel };
}

async function openSelectivePull(
	page: Page,
	timeoutMs: number
): Promise< AppliedCapturePresentationAction > {
	const pullButton = page.locator( 'button[aria-label="Pull from live"]' ).first();
	await pullButton.waitFor( { state: 'visible', timeout: timeoutMs } );
	await pullButton.click( { timeout: timeoutMs } );

	const submitButton = page.locator( '[data-testid="sync-dialog-pull-button"]' );
	await submitButton.waitFor( { state: 'visible', timeout: timeoutMs } );
	const tree = page.getByRole( 'tree' );
	await tree.waitFor( { state: 'visible', timeout: timeoutMs } );
	await tree.getByRole( 'treeitem' ).first().waitFor( { state: 'visible', timeout: timeoutMs } );
	const database = tree.getByRole( 'treeitem', { name: 'Database', exact: true } );
	await database.getByRole( 'checkbox' ).check( { timeout: timeoutMs } );
	await page.waitForFunction(
		() =>
			document
				.querySelector( '[role="treeitem"][aria-label="Database"]' )
				?.getAttribute( 'aria-checked' ) === 'true',
		undefined,
		{ timeout: timeoutMs }
	);
	await settlePaint( page );

	return {
		kind: 'open-selective-pull',
		dialogSubmitVisible: true,
		selectedItems: [ 'Database' ],
		treeItemCount: await tree.getByRole( 'treeitem' ).count(),
	};
}

async function showResponsiveComparison(
	page: Page,
	timeoutMs: number
): Promise< AppliedCapturePresentationAction > {
	const preview = page.locator( '[aria-label="Site preview"]' );
	await preview.waitFor( { state: 'visible', timeout: timeoutMs } );
	const moreOptions = preview.getByRole( 'button', { name: 'More options' } );
	await moreOptions.click( { timeout: timeoutMs } );

	const comparison = page.getByRole( 'menuitemradio', {
		name: 'Desktop + Mobile',
		exact: true,
	} );
	await comparison.waitFor( { state: 'visible', timeout: timeoutMs } );
	await comparison.click( { timeout: timeoutMs } );
	await page.waitForFunction(
		() =>
			document
				.querySelector( '[role="menuitemradio"][aria-checked="true"]' )
				?.textContent?.includes( 'Desktop + Mobile' ) ?? false,
		undefined,
		{ timeout: timeoutMs }
	);

	if ( await comparison.isVisible() ) {
		await page.keyboard.press( 'Escape' );
	}
	await comparison.waitFor( { state: 'hidden', timeout: timeoutMs } );

	await page.waitForFunction(
		() => {
			const previewElement = document.querySelector< HTMLElement >( '[aria-label="Site preview"]' );
			if ( ! previewElement || previewElement.querySelectorAll( 'iframe' ).length !== 2 ) {
				return false;
			}
			const rect = previewElement.getBoundingClientRect();
			return rect.width >= window.innerWidth - 2 && rect.height >= window.innerHeight - 2;
		},
		undefined,
		{ timeout: timeoutMs }
	);

	return {
		kind: 'show-responsive-comparison',
		menuDismissed: true,
		fullscreen: true,
		iframeCount: 2,
	};
}

async function applyComposerPresentation(
	page: Page,
	presentation: CapturePresentation,
	timeoutMs: number
): Promise< AppliedCapturePresentation[ 'composer' ] > {
	if ( presentation.composerText === undefined && presentation.composerFocus === undefined ) {
		return null;
	}

	const textarea = page.locator( COMPOSER_TEXTAREA_SELECTOR ).first();
	try {
		await textarea.waitFor( { state: 'visible', timeout: timeoutMs } );
	} catch {
		throw new Error(
			`Composer presentation requested, but no visible ${ COMPOSER_TEXTAREA_SELECTOR } was found.`
		);
	}

	if ( presentation.composerText !== undefined ) {
		await textarea.fill( presentation.composerText, { timeout: timeoutMs } );
		await page.waitForFunction(
			( { selector, text } ) =>
				( document.querySelector< HTMLTextAreaElement >( selector )?.value ?? null ) === text,
			{ selector: COMPOSER_TEXTAREA_SELECTOR, text: presentation.composerText },
			{ timeout: timeoutMs }
		);
	}

	const expectedFocus = presentation.composerFocus ?? 'blurred';
	if ( expectedFocus === 'focused' ) {
		await textarea.focus();
		await textarea.evaluate( ( node ) => {
			const composer = node as HTMLTextAreaElement;
			composer.setSelectionRange( composer.value.length, composer.value.length );
		} );
	} else {
		await textarea.evaluate( ( node ) => ( node as HTMLTextAreaElement ).blur() );
	}

	const effective = await textarea.evaluate( ( node ) => {
		const composer = node as HTMLTextAreaElement;
		return {
			text: composer.value,
			focus: document.activeElement === composer ? 'focused' : 'blurred',
		};
	} );

	if ( effective.focus !== expectedFocus ) {
		throw new Error( `Composer focus did not settle as ${ expectedFocus }.` );
	}

	return effective as AppliedCapturePresentation[ 'composer' ];
}

async function applyConversationPresentation(
	page: Page,
	presentation: CapturePresentation,
	timeoutMs: number
): Promise< AppliedCapturePresentation[ 'conversation' ] > {
	const anchor = presentation.conversationAnchor;
	if ( ! anchor ) {
		return null;
	}

	const messages = page.locator( MESSAGE_SELECTOR );
	try {
		await messages.first().waitFor( { state: 'visible', timeout: timeoutMs } );
	} catch {
		throw new Error(
			`Conversation presentation requested, but no visible ${ MESSAGE_SELECTOR } anchor was found.`
		);
	}

	let targetIndex = 0;
	if ( anchor.kind === 'message' ) {
		targetIndex = anchor.position === 'first' ? 0 : ( await messages.count() ) - 1;
	} else if ( anchor.kind === 'message-text' ) {
		const matchingIndexes = await messages.evaluateAll(
			( nodes, text ) =>
				nodes.flatMap( ( node, index ) =>
					( node.getAttribute( 'data-message-text' ) ?? '' ).includes( text ) ? [ index ] : []
				),
			anchor.text
		);
		if ( matchingIndexes.length === 0 ) {
			throw new Error( `No conversation message contains ${ JSON.stringify( anchor.text ) }.` );
		}
		targetIndex =
			presentation.conversationOccurrence === 'last'
				? matchingIndexes[ matchingIndexes.length - 1 ]
				: matchingIndexes[ 0 ];
	}

	const target = messages.nth( targetIndex );
	const result = await target.evaluate(
		async ( node, request ) => {
			const element = node as HTMLElement;
			let scrollContainer = element.parentElement;
			while ( scrollContainer ) {
				const style = window.getComputedStyle( scrollContainer );
				if ( /(auto|scroll|overlay)/.test( `${ style.overflow } ${ style.overflowY }` ) ) {
					break;
				}
				scrollContainer = scrollContainer.parentElement;
			}
			if ( ! scrollContainer ) {
				throw new Error( 'No scrollable conversation ancestor was found.' );
			}

			if ( request.edge ) {
				scrollContainer.scrollTop = request.edge === 'start' ? 0 : scrollContainer.scrollHeight;
			} else {
				const containerRect = scrollContainer.getBoundingClientRect();
				const elementRect = element.getBoundingClientRect();
				const style = window.getComputedStyle( scrollContainer );
				const paddingTop = Number.parseFloat( style.paddingTop ) || 0;
				const paddingBottom = Number.parseFloat( style.paddingBottom ) || 0;
				const visibleTop = containerRect.top + paddingTop;
				const visibleBottom = containerRect.bottom - paddingBottom;
				let scrollDelta = 0;

				switch ( request.alignment ) {
					case 'start':
						scrollDelta = elementRect.top - visibleTop;
						break;
					case 'center':
						scrollDelta =
							( elementRect.top + elementRect.bottom ) / 2 - ( visibleTop + visibleBottom ) / 2;
						break;
					case 'end':
						scrollDelta = elementRect.bottom - visibleBottom;
						break;
					case 'nearest':
						scrollDelta =
							elementRect.top < visibleTop
								? elementRect.top - visibleTop
								: Math.max( elementRect.bottom - visibleBottom, 0 );
						break;
				}

				scrollContainer.scrollTop += scrollDelta;
			}

			await new Promise< void >( ( resolve ) => {
				requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) );
			} );

			const containerRect = scrollContainer.getBoundingClientRect();
			const elementRect = element.getBoundingClientRect();
			const style = window.getComputedStyle( scrollContainer );
			const visibleTop = containerRect.top + ( Number.parseFloat( style.paddingTop ) || 0 );
			const visibleBottom =
				containerRect.bottom - ( Number.parseFloat( style.paddingBottom ) || 0 );

			return {
				matchedMessageText:
					request.edge === null ? element.getAttribute( 'data-message-text' ) : null,
				scrollTop: scrollContainer.scrollTop,
				scrollHeight: scrollContainer.scrollHeight,
				clientHeight: scrollContainer.clientHeight,
				targetVisible:
					request.edge !== null ||
					( elementRect.bottom > visibleTop && elementRect.top < visibleBottom ),
			};
		},
		{
			edge: anchor.kind === 'edge' ? anchor.edge : null,
			alignment: presentation.conversationAlignment ?? 'center',
		}
	);

	if ( ! result.targetVisible ) {
		throw new Error(
			'The requested conversation message did not settle inside the visible region.'
		);
	}

	return {
		anchor,
		alignment: anchor.kind === 'edge' ? undefined : presentation.conversationAlignment,
		occurrence: anchor.kind === 'message-text' ? presentation.conversationOccurrence : undefined,
		matchedMessageText: result.matchedMessageText,
		scrollTop: result.scrollTop,
		scrollHeight: result.scrollHeight,
		clientHeight: result.clientHeight,
	};
}

async function settlePaint( page: Page ): Promise< void > {
	await page.evaluate(
		() =>
			new Promise< void >( ( resolve ) => {
				requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) );
			} )
	);
}
