import { __ } from '@wordpress/i18n';
import { useSyncExternalStore } from 'react';
import type { Connector } from '@/data/core';

// Session-only dismissals for persistent sidebar cards.
export const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

type ToastIntent = 'success' | 'info' | 'warning' | 'error';

export type ToastAction = {
	label: string;
	onClick: () => void | Promise< unknown >;
	// Reading details does not resolve the problem.
	dismissOnSuccess?: boolean;
};

type ToastInput = {
	// Optional stable id. Re-showing an id that is still visible or queued
	// replaces it in place and restarts its timer — useful for actions the
	// user can spam, like "Copied".
	id?: string;
	intent?: ToastIntent;
	title: string;
	description?: string;
	action?: ToastAction;
	// Zero keeps the notice visible until it is dismissed or replaced.
	durationMs?: number;
	dismissible?: boolean;
	processing?: boolean;
};

export type ToastMessage = {
	id: string;
	intent: ToastIntent;
	title: string;
	description?: string;
	action?: ToastAction;
	durationMs: number;
	dismissible?: boolean;
	processing?: boolean;
	// True while the exit transition plays. The toast stays in the visible
	// list (so the renderer can animate it out) and is actually removed —
	// and the queue promoted — TOAST_EXIT_MS later.
	leaving?: boolean;
	// True while the action runs; it can't be clicked again until it fails.
	actionPending?: boolean;
};

export type NoticeIntent = ToastIntent;

export type Notice = Pick<
	ToastMessage,
	'intent' | 'title' | 'description' | 'action' | 'actionPending' | 'processing'
> & { source?: 'studio' };

const DEFAULT_TOAST_TTL_MS = 4_500;
const MAX_VISIBLE_TOASTS = 3;
// The length of the deck's exit slide, before the queue is promoted.
export const TOAST_EXIT_MS = 240;

let visible: ToastMessage[] = [];
let queued: ToastMessage[] = [];
let nextId = 1;
let rendererMounted = false;

const dismissedProcessingNotices = new Set< string >();
const pendingActions = new Set< ToastAction >();

const timers = new Map< string, ReturnType< typeof setTimeout > >();
const listeners = new Set< () => void >();

let snapshot: readonly ToastMessage[] = visible;

function emit() {
	snapshot = [ ...visible ];
	for ( const listener of listeners ) {
		listener();
	}
}

function clearExpiryTimer( id: string ) {
	const timer = timers.get( id );
	if ( timer ) {
		clearTimeout( timer );
		timers.delete( id );
	}
}

// Expiry timers live in the store (not the component) so queue promotion is
// atomic with expiry, and so a toast's clock only starts once it is actually
// visible — queued confirmations keep their full duration.
function scheduleExpiry( toast: ToastMessage ) {
	clearExpiryTimer( toast.id );
	if (
		! rendererMounted ||
		toast.processing ||
		toast.dismissible === false ||
		toast.durationMs === 0
	) {
		return;
	}
	const timer = setTimeout( () => {
		timers.delete( toast.id );
		beginToastExit( toast.id );
	}, toast.durationMs );
	timers.set( toast.id, timer );
}

function isPersistent( message: ToastMessage ): boolean {
	return !! message.processing || message.durationMs === 0 || message.dismissible === false;
}

function promoteQueued() {
	while ( visible.length < MAX_VISIBLE_TOASTS && queued.length > 0 ) {
		const next = queued.shift() as ToastMessage;
		visible = [ ...visible, next ];
		scheduleExpiry( next );
	}
}

function finalizeToastRemoval( id: string ) {
	clearExpiryTimer( id );
	visible = visible.filter( ( toast ) => toast.id !== id );
	promoteQueued();
	emit();
}

function beginToastExit( id: string ) {
	const target = visible.find( ( toast ) => toast.id === id );
	if ( ! target ) {
		queued = queued.filter( ( toast ) => toast.id !== id );
		emit();
		return;
	}
	if ( target.leaving ) {
		return;
	}
	clearExpiryTimer( id );
	visible = visible.map( ( toast ) => ( toast.id === id ? { ...toast, leaving: true } : toast ) );
	emit();
	const timer = setTimeout( () => {
		timers.delete( id );
		finalizeToastRemoval( id );
	}, TOAST_EXIT_MS );
	timers.set( id, timer );
}

export function showToast( input: ToastInput ): string {
	const intent = input.intent ?? 'info';
	const duplicate =
		! input.id && ( intent === 'error' || intent === 'warning' )
			? [ ...visible, ...queued ].find(
					( item ) =>
						item.intent === intent &&
						item.title === input.title &&
						item.description === input.description
			  )
			: undefined;
	const toastMessage: ToastMessage = {
		id: input.id ?? duplicate?.id ?? `toast-${ nextId++ }`,
		intent,
		title: input.title,
		description: input.description,
		action: input.action,
		actionPending: input.action && pendingActions.has( input.action ) ? true : undefined,
		dismissible: input.dismissible,
		processing: input.processing,
		durationMs:
			input.durationMs ?? ( intent === 'error' || intent === 'warning' ? 0 : DEFAULT_TOAST_TTL_MS ),
	};
	if ( toastMessage.processing && dismissedProcessingNotices.has( toastMessage.id ) ) {
		return toastMessage.id;
	}
	if ( ! toastMessage.processing ) dismissedProcessingNotices.delete( toastMessage.id );

	if ( visible.some( ( toast ) => toast.id === toastMessage.id ) ) {
		// Re-showing also rescues a toast mid-exit: the replacement carries no
		// leaving flag, and scheduleExpiry clears the pending removal timer.
		visible = visible.map( ( toast ) => ( toast.id === toastMessage.id ? toastMessage : toast ) );
		scheduleExpiry( toastMessage );
	} else if ( queued.some( ( toast ) => toast.id === toastMessage.id ) ) {
		queued = queued.filter( ( item ) => item.id !== toastMessage.id );
		if ( isPersistent( toastMessage ) ) {
			visible = [ ...visible, toastMessage ];
		} else {
			queued = [ ...queued, toastMessage ];
		}
	} else if ( visible.length < MAX_VISIBLE_TOASTS || isPersistent( toastMessage ) ) {
		visible = [ ...visible, toastMessage ];
		scheduleExpiry( toastMessage );
	} else {
		queued = [ ...queued, toastMessage ];
	}

	emit();
	return toastMessage.id;
}

export function dismissToast( id: string ): void {
	const target = [ ...visible, ...queued ].find( ( toast ) => toast.id === id );
	if ( target?.dismissible === false ) return;
	if ( target?.processing ) dismissedProcessingNotices.add( id );
	beginToastExit( id );
}

// Programmatic completion also releases a dismissed operation for its next run.
export function clearToast( id: string ): void {
	dismissedProcessingNotices.delete( id );
	beginToastExit( id );
}

export function errorMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}

function setActionPending( action: ToastAction, actionPending: boolean ) {
	if ( actionPending ) pendingActions.add( action );
	else pendingActions.delete( action );
	const update = < T extends { action?: ToastAction } >( item: T ): T =>
		item.action === action ? { ...item, actionPending } : item;
	visible = visible.map( update );
	queued = queued.map( update );
	emit();
}

// Only a recovery action dismisses an error; inspecting it leaves it available.
export async function runNoticeAction( action: ToastAction ): Promise< boolean > {
	const offering = visible.filter( ( item ) => ! item.leaving && item.action === action );
	if ( ! offering.length || offering.some( ( item ) => item.actionPending ) ) return false;
	const toastIds = offering.map( ( item ) => item.id );
	toastIds.forEach( clearExpiryTimer );
	setActionPending( action, true );
	try {
		await action.onClick();
		if ( action.dismissOnSuccess !== false ) {
			for ( const id of toastIds ) {
				if ( visible.some( ( item ) => item.id === id && item.action === action ) ) {
					beginToastExit( id );
				}
			}
		}
		return true;
	} catch ( error ) {
		for ( const id of toastIds ) {
			if ( visible.some( ( item ) => item.id === id && item.action === action ) ) {
				const original = offering.find( ( item ) => item.id === id )!;
				const detail = errorMessage( error );
				if ( original.processing ) {
					toast.error( __( 'Action failed' ), { description: detail } );
					continue;
				}
				let description = detail;
				if ( action.dismissOnSuccess === false && original.description ) {
					description = original.description.includes( detail )
						? original.description
						: `${ original.description }\n${ detail }`;
				}
				toast.error( action.dismissOnSuccess === false ? original.title : __( 'Action failed' ), {
					id,
					description,
					action,
				} );
			}
		}
		return false;
	} finally {
		setActionPending( action, false );
		toastIds.forEach( resumeToastExpiry );
	}
}

export const toast = {
	processing: (
		title: string,
		options: Omit< ToastInput, 'title' | 'intent' | 'processing' > = {}
	) => showToast( { dismissible: true, ...options, intent: 'info', title, processing: true } ),
	success: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'success', title, ...options } ),
	info: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'info', title, ...options } ),
	warning: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'warning', title, ...options } ),
	error: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'error', title, ...options } ),
};

// Only where the host keeps a log file the user can open.
export function openStudioLogsAction( connector: Connector ): ToastAction | undefined {
	if ( ! connector.capabilities.studioLogs ) {
		return undefined;
	}
	return {
		label: __( 'Open logs' ),
		dismissOnSuccess: false,
		onClick: () => connector.openStudioLogs(),
	};
}

// Hover and focus pause — <AppToasts /> calls these as the pointer or focus
// enters and leaves a toast. Resuming restarts the full duration; no
// remaining-time bookkeeping. A toast that is already exiting can't be paused
// or resumed: pausing would cancel its removal timer (stranding it), resuming
// would resurrect it.
export function pauseToastExpiry( id: string ): void {
	const toastMessage = visible.find( ( item ) => item.id === id );
	if ( toastMessage && ! toastMessage.leaving ) {
		clearExpiryTimer( id );
	}
}

export function resumeToastExpiry( id: string ): void {
	const toastMessage = visible.find( ( item ) => item.id === id );
	if ( toastMessage && ! toastMessage.leaving && ! toastMessage.actionPending ) {
		scheduleExpiry( toastMessage );
	}
}

export function notifyRendererMounted(): void {
	rendererMounted = true;
	for ( const toast of visible ) {
		if ( ! toast.leaving && ! timers.has( toast.id ) ) {
			scheduleExpiry( toast );
		}
	}
}

export function notifyRendererUnmounted(): void {
	rendererMounted = false;
	for ( const toast of visible ) {
		if ( ! toast.leaving ) {
			clearExpiryTimer( toast.id );
		}
	}
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function getVisibleToasts(): readonly ToastMessage[] {
	return snapshot;
}

export function useVisibleToasts(): readonly ToastMessage[] {
	return useSyncExternalStore(
		subscribe,
		() => snapshot,
		() => EMPTY_TOASTS
	);
}

export function getQueuedToastCount(): number {
	return queued.length;
}

const EMPTY_TOASTS: readonly ToastMessage[] = [];
// Title plus the full description, for the clipboard.
export function noticeToText( notice: Pick< Notice, 'title' | 'description' > ): string {
	return notice.description ? `${ notice.title }\n${ notice.description }` : notice.title;
}

export function resetAppMessagesForTests(): void {
	for ( const timer of timers.values() ) {
		clearTimeout( timer );
	}
	timers.clear();
	visible = [];
	queued = [];
	nextId = 1;
	rendererMounted = false;
	snapshot = visible;
	dismissedProcessingNotices.clear();
	pendingActions.clear();
}
