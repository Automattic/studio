// Timing and size records for one eval run, so a run shows where its time and
// context went: per model request, per tool, and summed.

export type ModelRequestRecord = {
	startedAtMs: number;
	endedAtMs: number;
	durationMs: number;
	// Everything the request sent: uncached input, cache reads and cache writes.
	contextTokens: number;
	outputTokens: number;
	stopReason: string;
	// The provider's message when the request failed (stopReason "error").
	errorMessage?: string;
	hasText: boolean;
	toolCalls: number;
};

export type TimedToolEvent = {
	toolName: string;
	startedAtMs: number;
	endedAtMs?: number;
	outputChars?: number;
	// Studio's checks around the tool's run, within its time.
	checksMs?: number;
};

type ToolTiming = {
	calls: number;
	totalMs: number;
	maxMs: number;
	outputChars: number;
	checksMs: number;
};

export type TimingSummary = {
	modelMs: number;
	// Wall-clock time with at least one tool running: parallel calls count once.
	toolWallMs: number;
	// Of the tools' time, Studio's checks around their runs.
	checksMs: number;
	requests: number;
	peakContextTokens: number;
	// Requests that ended with stopReason "stop" but no text and no tool call:
	// the turn ends and the user sees nothing.
	emptyStops: number;
	// By tool name, slowest total first.
	tools: Record< string, ToolTiming >;
};

export function summarizeTiming(
	requests: ModelRequestRecord[],
	toolEvents: TimedToolEvent[]
): TimingSummary {
	const byName = new Map< string, ToolTiming >();
	const intervals: Array< [ number, number ] > = [];
	for ( const event of toolEvents ) {
		if ( event.endedAtMs === undefined ) {
			continue;
		}
		const durationMs = event.endedAtMs - event.startedAtMs;
		intervals.push( [ event.startedAtMs, event.endedAtMs ] );
		const entry = byName.get( event.toolName ) ?? {
			calls: 0,
			totalMs: 0,
			maxMs: 0,
			outputChars: 0,
			checksMs: 0,
		};
		entry.calls += 1;
		entry.totalMs += durationMs;
		entry.maxMs = Math.max( entry.maxMs, durationMs );
		entry.outputChars += event.outputChars ?? 0;
		entry.checksMs += event.checksMs ?? 0;
		byName.set( event.toolName, entry );
	}

	let toolWallMs = 0;
	let coveredUntil = -Infinity;
	for ( const [ start, end ] of intervals.sort( ( a, b ) => a[ 0 ] - b[ 0 ] ) ) {
		const from = Math.max( start, coveredUntil );
		if ( end > from ) {
			toolWallMs += end - from;
			coveredUntil = end;
		}
	}

	return {
		modelMs: requests.reduce( ( sum, request ) => sum + request.durationMs, 0 ),
		toolWallMs,
		checksMs: [ ...byName.values() ].reduce( ( sum, tool ) => sum + tool.checksMs, 0 ),
		requests: requests.length,
		peakContextTokens: requests.reduce(
			( peak, request ) => Math.max( peak, request.contextTokens ),
			0
		),
		emptyStops: requests.filter(
			( request ) => request.stopReason === 'stop' && ! request.hasText && request.toolCalls === 0
		).length,
		tools: Object.fromEntries(
			[ ...byName.entries() ].sort( ( a, b ) => b[ 1 ].totalMs - a[ 1 ].totalMs )
		),
	};
}
