/**
 * Literal substring emitted by the Claude Agent SDK when a Task-spawned
 * subagent hits its own max-turn cap. Pinning it as a constant (with a
 * test) makes a future SDK wording change break loudly rather than silently
 * disable the continue prompt.
 */
export const SUBAGENT_MAX_TURNS_MARKER = 'Reached maximum number of turns';

const MAX_PROGRESS_CHARS = 200;

type ContentBlock = { type: string; text?: string } | Record< string, unknown >;

/**
 * Inspect a tool_result payload for evidence that a subagent ran out of turns.
 * Returns `{ lastProgress }` if detected (progress may be null if the payload
 * contains no preceding assistant text), or null otherwise.
 */
export function detectSubagentMaxTurns(
	content: string | ContentBlock[] | null | undefined
): { lastProgress: string | null } | null {
	if ( content == null ) {
		return null;
	}

	if ( typeof content === 'string' ) {
		return content.includes( SUBAGENT_MAX_TURNS_MARKER ) ? { lastProgress: null } : null;
	}

	if ( ! Array.isArray( content ) ) {
		return null;
	}

	const texts = content
		.filter(
			( block ): block is { type: 'text'; text: string } =>
				typeof block === 'object' &&
				block !== null &&
				( block as { type?: string } ).type === 'text' &&
				typeof ( block as { text?: unknown } ).text === 'string'
		)
		.map( ( block ) => block.text );

	const hasMarker = texts.some( ( text ) => text.includes( SUBAGENT_MAX_TURNS_MARKER ) );
	if ( ! hasMarker ) {
		return null;
	}

	const priorText = [ ...texts ]
		.reverse()
		.find( ( text ) => ! text.includes( SUBAGENT_MAX_TURNS_MARKER ) );

	const lastProgress = priorText ? priorText.slice( 0, MAX_PROGRESS_CHARS ) : null;

	return { lastProgress };
}
