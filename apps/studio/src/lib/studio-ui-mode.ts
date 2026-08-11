import type { TracksUiVersion } from '@studio/common/lib/record-tracks-event';

export type StudioUiMode = 'default' | 'agentic';

// Which renderer the app is currently running, seeded at boot from `betaFeatures.enableAgenticUi`
// and updated when the user switches. Lives here rather than in `main-window` so that modules
// `main-window` itself depends on (e.g. the CLI) can read it without an import cycle.
let agenticUiEnabled = false;

export function setAgenticUiEnabled( enabled: boolean ): void {
	agenticUiEnabled = enabled;
}

export function getPreferredStudioUiMode(): StudioUiMode {
	return agenticUiEnabled ? 'agentic' : 'default';
}

// The active renderer's Tracks `ui_version`. Single source of truth for the mode→version mapping,
// shared by the desktop Tracks wrapper's `commonProps()` and the CLI origin env.
export function getPreferredUiVersion(): TracksUiVersion {
	return getPreferredStudioUiMode() === 'agentic' ? 'v2' : 'v1';
}
