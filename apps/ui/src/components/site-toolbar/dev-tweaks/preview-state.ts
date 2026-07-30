import { deriveToolbarState } from '../derive-toolbar-state';
import { useTweaks } from './store';
import type { DeriveToolbarStateOptions, ToolbarState } from '../derive-toolbar-state';
import type { ToolbarTweaks, TweakScenario } from './store';
import type { SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

/**
 * TEMPORARY design scaffolding (STU-2162). Turns the panel's knobs into the
 * real `deriveToolbarState` inputs, so what the panel shows is what the state
 * table actually produces — then applies the presentation-only overrides on
 * top for treatments the table doesn't currently produce.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function historyTimestamp( history: ToolbarTweaks[ 'history' ] ): string | null {
	switch ( history ) {
		case 'just-now':
			return new Date( Date.now() - 20_000 ).toISOString();
		case 'hours':
			return new Date( Date.now() - 3 * HOUR_MS ).toISOString();
		case 'days':
			return new Date( Date.now() - 6 * DAY_MS ).toISOString();
		default:
			return null;
	}
}

function buildLiveSite( tweaks: ToolbarTweaks ): SyncSite | undefined {
	if ( tweaks.connection === 'none' ) {
		return undefined;
	}
	const isStaging = tweaks.connection === 'staging';
	const timestamp = historyTimestamp( tweaks.history );
	return {
		id: 123456,
		localSiteId: 'preview',
		name: isStaging ? 'My Site (staging)' : 'My Site',
		url: isStaging ? 'staging-mysite.wpcomstaging.com' : 'mysite.com',
		isStaging,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPushTimestamp: timestamp,
		lastPullTimestamp: tweaks.activity === 'pull-success' ? timestamp : null,
	};
}

function buildActivity( tweaks: ToolbarTweaks ): SyncActivity | null {
	const progress = tweaks.determinate ? tweaks.progress : undefined;

	switch ( tweaks.activity ) {
		case 'push-exporting':
			return { kind: 'pending', direction: 'push', phase: 'exporting' };
		case 'push-uploading':
			return { kind: 'pending', direction: 'push', phase: 'uploading', progress };
		case 'push-paused':
			return { kind: 'pending', direction: 'push', phase: 'paused', progress };
		case 'push-importing':
			return { kind: 'pending', direction: 'push', phase: 'importing' };
		case 'push-success':
			return { kind: 'success', direction: 'push' };
		case 'push-error':
			return {
				kind: 'error',
				direction: 'push',
				message: 'The upload was rejected by WordPress.com (413: payload too large).',
			};
		case 'pull-pending':
			return {
				kind: 'pending',
				direction: 'pull',
				message: 'Downloading the backup from WordPress.com.',
				progress,
			};
		case 'pull-success':
			return { kind: 'success', direction: 'pull' };
		case 'pull-error':
			return { kind: 'error', direction: 'pull', message: 'Could not reach WordPress.com.' };
		case 'preview-pending':
			return { kind: 'pending', direction: 'preview' };
		case 'preview-success':
			return { kind: 'success', direction: 'preview' };
		case 'preview-error':
			return {
				kind: 'error',
				direction: 'preview',
				message: 'The preview site could not be created.',
			};
		default:
			return null;
	}
}

function buildOptions( tweaks: ToolbarTweaks ): DeriveToolbarStateOptions {
	return {
		activity: buildActivity( tweaks ),
		direction: tweaks.direction,
		agenticEnabled: tweaks.auth === 'ok',
		agenticReason: tweaks.auth === 'ok' ? null : tweaks.auth,
		liveSite: buildLiveSite( tweaks ),
		isSyncing: tweaks.isSyncing,
		siteRunning: tweaks.run === 'running' || tweaks.run === 'stopping',
	};
}

function applyOverrides( state: ToolbarState, tweaks: ToolbarTweaks ): ToolbarState {
	const { status, action } = state;
	return {
		status:
			status && tweaks.statusTone !== 'auto' ? { ...status, tone: tweaks.statusTone } : status,
		action: {
			...action,
			...( tweaks.actionVariant === 'auto' ? {} : { variant: tweaks.actionVariant } ),
			...( tweaks.actionTone === 'auto' ? {} : { tone: tweaks.actionTone } ),
			...( tweaks.actionBusy === 'auto' ? {} : { busy: tweaks.actionBusy === 'on' } ),
			...( tweaks.actionDisabled === 'auto'
				? {}
				: {
						disabled: tweaks.actionDisabled === 'on',
						...( tweaks.actionDisabled === 'on'
							? { disabledReason: 'Forced by the tweaks panel.' }
							: { disabledReason: undefined } ),
				  } ),
		},
	};
}

export type ToolbarRunState = {
	running: boolean;
	isStarting: boolean;
	isStopping: boolean;
};

export type ToolbarPreview = {
	state: ToolbarState;
	run: ToolbarRunState;
	// The connection the pill's menu should describe: synthetic while the panel
	// drives, so the menu matches the state shown beside it.
	liveSite: SyncSite | undefined;
	// True while the panel is driving; the toolbar uses it to keep real
	// mutations from firing against a state the user is only looking at.
	active: boolean;
};

/**
 * Returns either the site's real toolbar state or the panel's synthetic one,
 * depending on whether the tweaks panel is switched on.
 */
export function useToolbarPreview(
	realOptions: DeriveToolbarStateOptions,
	realRun: ToolbarRunState
): ToolbarPreview {
	const tweaks = useTweaks();

	if ( ! import.meta.env.DEV || ! tweaks.enabled ) {
		return {
			state: deriveToolbarState( realOptions ),
			run: realRun,
			liveSite: realOptions.liveSite,
			active: false,
		};
	}

	const options = buildOptions( tweaks );

	return {
		state: applyOverrides( deriveToolbarState( options ), tweaks ),
		liveSite: options.liveSite,
		run: {
			running: tweaks.run === 'running' || tweaks.run === 'stopping',
			isStarting: tweaks.run === 'starting',
			isStopping: tweaks.run === 'stopping',
		},
		active: true,
	};
}

/** One-click jumps to the states worth comparing side by side. */
export const SCENARIOS: { id: string; label: string; tweaks: TweakScenario }[] = [
	{
		id: 'idle',
		label: 'Pushed 6d',
		tweaks: { connection: 'live', history: 'days', activity: 'none' },
	},
	{
		id: 'first-push',
		label: 'Never pushed',
		tweaks: { connection: 'live', history: 'never', activity: 'none' },
	},
	{
		id: 'no-live',
		label: 'No live site',
		tweaks: { connection: 'none', activity: 'none' },
	},
	{
		id: 'staging',
		label: 'Staging',
		tweaks: { connection: 'staging', history: 'hours', activity: 'none' },
	},
	{
		id: 'exporting',
		label: 'Preparing',
		tweaks: { connection: 'live', activity: 'push-exporting', isSyncing: true },
	},
	{
		id: 'uploading',
		label: 'Uploading %',
		tweaks: { connection: 'live', activity: 'push-uploading', determinate: true, isSyncing: true },
	},
	{
		id: 'paused',
		label: 'Upload paused',
		tweaks: { connection: 'live', activity: 'push-paused', determinate: true, isSyncing: true },
	},
	{
		id: 'importing',
		label: 'Applying',
		tweaks: { connection: 'live', activity: 'push-importing', isSyncing: true },
	},
	{
		id: 'pushed',
		label: 'Pushed ✓',
		tweaks: { connection: 'live', activity: 'push-success', isSyncing: false },
	},
	{
		id: 'push-failed',
		label: 'Push failed',
		tweaks: { connection: 'live', activity: 'push-error', isSyncing: false },
	},
	{
		id: 'pulling',
		label: 'Pulling',
		tweaks: { connection: 'live', activity: 'pull-pending', determinate: true, isSyncing: true },
	},
	{
		id: 'preview',
		label: 'Publishing preview',
		tweaks: { connection: 'live', activity: 'preview-pending', isSyncing: true },
	},
	{
		id: 'stopped',
		label: 'Site stopped',
		tweaks: { connection: 'live', activity: 'none', run: 'stopped' },
	},
	{
		id: 'offline',
		label: 'Offline',
		tweaks: { connection: 'live', activity: 'none', auth: 'offline' },
	},
	{
		id: 'signed-out',
		label: 'Signed out',
		tweaks: { connection: 'none', activity: 'none', auth: 'signed-out' },
	},
];

/**
 * A scripted push, so the transitions between phases — and the progress fill —
 * can be watched rather than stepped through by hand.
 */
export const PUSH_SEQUENCE: { at: number; tweaks: TweakScenario }[] = [
	{
		at: 0,
		tweaks: { connection: 'live', history: 'days', activity: 'push-exporting', isSyncing: true },
	},
	{ at: 1200, tweaks: { activity: 'push-uploading', determinate: true, progress: 6 } },
	{ at: 1900, tweaks: { progress: 21 } },
	{ at: 2600, tweaks: { progress: 38 } },
	{ at: 3300, tweaks: { progress: 57 } },
	{ at: 4000, tweaks: { progress: 74 } },
	{ at: 4700, tweaks: { progress: 91 } },
	{ at: 5400, tweaks: { progress: 100 } },
	{ at: 6100, tweaks: { activity: 'push-importing' } },
	{ at: 8200, tweaks: { activity: 'push-success', isSyncing: false } },
	{ at: 13_200, tweaks: { activity: 'none', history: 'just-now' } },
];
