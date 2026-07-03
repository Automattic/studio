import { useSyncExternalStore } from 'react';

// Ephemeral app-wide toasts ("the app's voice"): action feedback and
// background-work outcomes, rendered by <AppToasts /> at the bottom of the
// sidebar (or floating over the main panel when the sidebar is collapsed).
// Uses a module-level store (rather than React context) so toasts can be
// dispatched from anywhere — react-query mutation callbacks, connector event
// handlers — and survive the mount-point swap when the sidebar collapses.

export type ToastIntent = 'success' | 'info' | 'error';

export type ToastAction = {
	label: string;
	onClick: () => void;
};

export type ToastInput = {
	// Optional stable id. Re-showing an id that is still visible or queued
	// replaces it in place and restarts its timer — useful for actions the
	// user can spam, like "Copied".
	id?: string;
	intent?: ToastIntent;
	title: string;
	description?: string;
	action?: ToastAction;
	durationMs?: number;
};

export type ToastMessage = {
	id: string;
	intent: ToastIntent;
	title: string;
	description?: string;
	action?: ToastAction;
	durationMs: number;
};

const DEFAULT_TOAST_TTL_MS = 4_500;
// Failures linger so a glance away doesn't miss them.
const ERROR_TOAST_TTL_MS = 10_000;
const MAX_VISIBLE_TOASTS = 3;

// Oldest first; capped at MAX_VISIBLE_TOASTS. Overflow waits in `queued` and
// is promoted FIFO as visible toasts expire or are dismissed.
let visible: ToastMessage[] = [];
let queued: ToastMessage[] = [];
let nextId = 1;

const timers = new Map< string, ReturnType< typeof setTimeout > >();
const listeners = new Set< () => void >();

let snapshot: readonly ToastMessage[] = visible;

function emit() {
	// useSyncExternalStore compares snapshot references, so rebuild the array
	// instead of mutating the existing reference.
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
// visible — queued failures keep their full linger time.
function scheduleExpiry( toast: ToastMessage ) {
	clearExpiryTimer( toast.id );
	const timer = setTimeout( () => {
		timers.delete( toast.id );
		removeToast( toast.id );
	}, toast.durationMs );
	timers.set( toast.id, timer );
}

function promoteQueued() {
	while ( visible.length < MAX_VISIBLE_TOASTS && queued.length > 0 ) {
		const next = queued.shift() as ToastMessage;
		visible = [ ...visible, next ];
		scheduleExpiry( next );
	}
}

function removeToast( id: string ) {
	clearExpiryTimer( id );
	if ( visible.some( ( toast ) => toast.id === id ) ) {
		visible = visible.filter( ( toast ) => toast.id !== id );
		promoteQueued();
	} else {
		queued = queued.filter( ( toast ) => toast.id !== id );
	}
	emit();
}

export function showToast( input: ToastInput ): string {
	const intent = input.intent ?? 'info';
	const toastMessage: ToastMessage = {
		id: input.id ?? `toast-${ nextId++ }`,
		intent,
		title: input.title,
		description: input.description,
		action: input.action,
		durationMs:
			input.durationMs ?? ( intent === 'error' ? ERROR_TOAST_TTL_MS : DEFAULT_TOAST_TTL_MS ),
	};

	if ( visible.some( ( toast ) => toast.id === toastMessage.id ) ) {
		visible = visible.map( ( toast ) => ( toast.id === toastMessage.id ? toastMessage : toast ) );
		scheduleExpiry( toastMessage );
	} else if ( queued.some( ( toast ) => toast.id === toastMessage.id ) ) {
		queued = queued.map( ( toast ) => ( toast.id === toastMessage.id ? toastMessage : toast ) );
	} else if ( visible.length < MAX_VISIBLE_TOASTS ) {
		visible = [ ...visible, toastMessage ];
		scheduleExpiry( toastMessage );
	} else {
		queued = [ ...queued, toastMessage ];
	}

	emit();
	return toastMessage.id;
}

export function dismissToast( id: string ): void {
	removeToast( id );
}

export const toast = {
	success: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'success', title, ...options } ),
	info: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'info', title, ...options } ),
	error: ( title: string, options: Omit< ToastInput, 'title' | 'intent' > = {} ) =>
		showToast( { intent: 'error', title, ...options } ),
};

// Hover pause — <AppToasts /> calls these on mouse enter/leave. Resuming
// restarts the full duration; no remaining-time bookkeeping.
export function pauseToastExpiry( id: string ): void {
	clearExpiryTimer( id );
}

export function resumeToastExpiry( id: string ): void {
	const toastMessage = visible.find( ( item ) => item.id === id );
	if ( toastMessage ) {
		scheduleExpiry( toastMessage );
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

// How many toasts are waiting behind the visible three — the renderer shows
// a stacked-card peek so the queue is perceivable before it promotes.
export function useQueuedToastCount(): number {
	return useSyncExternalStore(
		subscribe,
		() => queued.length,
		() => 0
	);
}

const EMPTY_TOASTS: readonly ToastMessage[] = [];

export function resetAppMessagesForTests(): void {
	for ( const timer of timers.values() ) {
		clearTimeout( timer );
	}
	timers.clear();
	visible = [];
	queued = [];
	nextId = 1;
	snapshot = visible;
}
