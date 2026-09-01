import { useSyncExternalStore } from 'react';

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
	// True while the exit transition plays. The toast stays in the visible
	// list (so the renderer can animate it out) and is actually removed —
	// and the queue promoted — TOAST_EXIT_MS later.
	leaving?: boolean;
};

const DEFAULT_TOAST_TTL_MS = 4_500;
// Failures linger so a glance away doesn't miss them.
const ERROR_TOAST_TTL_MS = 10_000;
const MAX_VISIBLE_TOASTS = 3;
// Slightly longer than the CSS exit transition (180ms) so the collapse
// finishes before the node is dropped.
export const TOAST_EXIT_MS = 200;

let visible: ToastMessage[] = [];
let queued: ToastMessage[] = [];
let nextId = 1;
let rendererMounted = false;

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
// visible — queued failures keep their full linger time.
function scheduleExpiry( toast: ToastMessage ) {
	clearExpiryTimer( toast.id );
	if ( ! rendererMounted ) {
		return;
	}
	const timer = setTimeout( () => {
		timers.delete( toast.id );
		beginToastExit( toast.id );
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
		// Re-showing also rescues a toast mid-exit: the replacement carries no
		// leaving flag, and scheduleExpiry clears the pending removal timer.
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
	beginToastExit( id );
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
// restarts the full duration; no remaining-time bookkeeping. A toast that is
// already exiting can't be paused or resumed: pausing would cancel its
// removal timer (stranding it), resuming would resurrect it.
export function pauseToastExpiry( id: string ): void {
	const toastMessage = visible.find( ( item ) => item.id === id );
	if ( toastMessage && ! toastMessage.leaving ) {
		clearExpiryTimer( id );
	}
}

export function resumeToastExpiry( id: string ): void {
	const toastMessage = visible.find( ( item ) => item.id === id );
	if ( toastMessage && ! toastMessage.leaving ) {
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
	rendererMounted = false;
	snapshot = visible;
}
