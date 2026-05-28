import type { StoredStudioUiMode, StudioUiMode } from '../types/desk';

export const STUDIO_UI_MODE_DEFAULT: StudioUiMode = 'default';
export const STUDIO_UI_MODE_STUDIO2: StudioUiMode = 'studio2';

const SUPPORTED_STUDIO_UI_MODES = new Set< StoredStudioUiMode >( [
	'default',
	'studio2',
	'agentic',
	'desks',
] );

export function normalizeStudioUiMode( mode: unknown ): StudioUiMode {
	return mode === 'studio2' || mode === 'agentic' || mode === 'desks'
		? STUDIO_UI_MODE_STUDIO2
		: STUDIO_UI_MODE_DEFAULT;
}

export function assertSupportedStudioUiMode( mode: unknown ): asserts mode is StoredStudioUiMode {
	if ( ! SUPPORTED_STUDIO_UI_MODES.has( mode as StoredStudioUiMode ) ) {
		throw new Error( 'Invalid Studio UI mode.' );
	}
}
