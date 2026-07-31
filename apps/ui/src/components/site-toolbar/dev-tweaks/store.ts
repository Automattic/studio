import { useSyncExternalStore } from 'react';
import type { ToolbarStatusTone } from '../derive-toolbar-state';

/**
 * TEMPORARY design scaffolding (STU-2162). Dev-only state backing the floating
 * tweaks panel, which drives the toolbar's status pill and action button by
 * hand so every state can be looked at without reproducing it for real.
 *
 * To remove: delete this folder and the two `dev-tweaks` references in
 * `../index.tsx`.
 */

const STORAGE_KEY = 'studio.dev.toolbar-tweaks';

export type TweakConnection = 'none' | 'live' | 'staging';
export type TweakHistory = 'never' | 'just-now' | 'hours' | 'days';
export type TweakActivity =
	| 'none'
	| 'push-exporting'
	| 'push-uploading'
	| 'push-paused'
	| 'push-importing'
	| 'push-success'
	| 'push-error'
	| 'pull-pending'
	| 'pull-success'
	| 'pull-error'
	| 'preview-pending'
	| 'preview-success'
	| 'preview-error';
export type TweakAuth = 'ok' | 'signed-out' | 'offline';
export type TweakRun = 'running' | 'stopped' | 'starting' | 'stopping';
export type TweakToggle = 'auto' | 'on' | 'off';

export type ToolbarTweaks = {
	// Master switch. Off means the toolbar shows the site's real state.
	enabled: boolean;
	open: boolean;
	x: number;
	y: number;

	// Inputs to `deriveToolbarState` — the real state table, driven by hand.
	connection: TweakConnection;
	history: TweakHistory;
	activity: TweakActivity;
	progress: number;
	determinate: boolean;
	auth: TweakAuth;
	run: TweakRun;
	isSyncing: boolean;

	// Presentation overrides applied on top of the derived result, for trying
	// treatments the state table doesn't currently produce.
	statusTone: 'auto' | ToolbarStatusTone;
	actionVariant: 'auto' | 'solid' | 'outline';
	actionTone: 'auto' | 'brand' | 'neutral';
	actionBusy: TweakToggle;
	actionDisabled: TweakToggle;
};

export const DEFAULT_TWEAKS: ToolbarTweaks = {
	enabled: false,
	open: false,
	x: 24,
	y: 96,

	connection: 'live',
	history: 'days',
	activity: 'none',
	progress: 42,
	determinate: true,
	auth: 'ok',
	run: 'running',
	isSyncing: false,

	statusTone: 'auto',
	actionVariant: 'auto',
	actionTone: 'auto',
	actionBusy: 'auto',
	actionDisabled: 'auto',
};

// The knobs a preset is allowed to set: position and open/closed survive.
export type TweakScenario = Partial< Omit< ToolbarTweaks, 'enabled' | 'open' | 'x' | 'y' > >;

const listeners = new Set< () => void >();

function load(): ToolbarTweaks {
	try {
		const raw = globalThis.localStorage?.getItem( STORAGE_KEY );
		if ( ! raw ) {
			return DEFAULT_TWEAKS;
		}
		return { ...DEFAULT_TWEAKS, ...( JSON.parse( raw ) as Partial< ToolbarTweaks > ) };
	} catch {
		return DEFAULT_TWEAKS;
	}
}

let state: ToolbarTweaks = load();

function persist() {
	try {
		globalThis.localStorage?.setItem( STORAGE_KEY, JSON.stringify( state ) );
	} catch {
		// A dev tool that can't remember its own settings is still a dev tool.
	}
}

export function setTweaks( patch: Partial< ToolbarTweaks > ): void {
	state = { ...state, ...patch };
	persist();
	for ( const listener of listeners ) {
		listener();
	}
}

/** Restores every state knob, leaving the panel where it is and open. */
export function resetTweaks(): void {
	setTweaks( {
		...DEFAULT_TWEAKS,
		enabled: state.enabled,
		open: state.open,
		x: state.x,
		y: state.y,
	} );
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function useTweaks(): ToolbarTweaks {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => state
	);
}

export function getTweaks(): ToolbarTweaks {
	return state;
}
