// How long the agent's replies should be. A global preference shared by the
// desktop settings screens and the CLI (`~/.studio/shared.json`); the CLI
// resolves it per turn and applies it via the response-length pi extension.

export const AI_RESPONSE_LENGTHS = [ 'verbose', 'normal', 'compact' ] as const;

export type AiResponseLength = ( typeof AI_RESPONSE_LENGTHS )[ number ];

export const DEFAULT_RESPONSE_LENGTH: AiResponseLength = 'normal';

export function isAiResponseLength( value: unknown ): value is AiResponseLength {
	return (
		typeof value === 'string' && ( AI_RESPONSE_LENGTHS as readonly string[] ).includes( value )
	);
}
