// Shape of the `tool_execution_update` partial result Studio tools emit for
// progress. The agent loop stamps the event with the toolCallId, so every
// consumer (TUI, agentic UI, desktop, remote session) can attribute the line
// to its tool call without any shared mutable state.
export interface StudioToolProgressUpdate {
	studioProgress: {
		message: string;
		update?: boolean;
	};
}

export function getStudioToolProgress(
	partialResult: unknown
): StudioToolProgressUpdate[ 'studioProgress' ] | null {
	const details = ( partialResult as { details?: unknown } | null )?.details;
	const progress = ( details as Partial< StudioToolProgressUpdate > | null )?.studioProgress;
	if ( ! progress || typeof progress.message !== 'string' ) {
		return null;
	}
	return progress;
}
