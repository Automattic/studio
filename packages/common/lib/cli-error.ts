import { z } from 'zod';

/**
 * Schema for errors that include CLI args context for Sentry reporting.
 * Used when parsing errors from CLI operations.
 */
export const cliErrorSchema = z.object( {
	message: z.string(),
	stack: z.string().optional(),
	cliArgs: z.record( z.string(), z.unknown() ).optional(),
} );

export type CliError = z.infer< typeof cliErrorSchema >;

/**
 * Attempts to parse an unknown error as a CLI error with cliArgs.
 * Returns the parsed error if successful, or null if the error doesn't match the schema.
 */
export function parseCliError( error: unknown ): CliError | null {
	if ( ! ( error instanceof Error ) ) {
		return null;
	}

	const result = cliErrorSchema.safeParse( {
		message: error.message,
		stack: error.stack,
		cliArgs: 'cliArgs' in error ? error.cliArgs : undefined,
	} );

	return result.success ? result.data : null;
}

/**
 * Checks if the error message contains a specific string.
 */
export function errorMessageContains( error: unknown, substring: string ): boolean {
	if ( error instanceof Error ) {
		return error.message.includes( substring );
	}
	return false;
}
