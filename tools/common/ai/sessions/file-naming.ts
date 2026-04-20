import path from 'path';

const SESSION_FILE_EXTENSION = '.jsonl';
const SESSION_ID_REGEX = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

/**
 * Session files follow this stable naming contract:
 * `<iso8601-filename-timestamp>-<session-uuid>.jsonl`
 *
 * Example:
 * `2026-03-11T10-00-00-8b4cead7-3f8b-4727-86cd-a495c055850a.jsonl`
 *
 * Why this format:
 * - The ISO-8601-derived timestamp prefix keeps files lexicographically sortable by start time.
 * - `:` is replaced with `-` so filenames are valid on Windows.
 * - UUID suffix guarantees uniqueness for sessions started in the same second.
 */
export function buildAiSessionFileName( startedAt: Date, sessionId: string ): string {
	const sortableTimestamp = startedAt
		.toISOString()
		.replace( /:/g, '-' )
		.replace( /\.\d{3}Z$/, '' );
	return `${ sortableTimestamp }-${ sessionId }${ SESSION_FILE_EXTENSION }`;
}

/**
 * Reads the canonical session id from a session file path produced by
 * `buildAiSessionFileName()`.
 *
 * If the file does not match the expected contract, we fall back to the bare
 * filename (without extension) so older/unexpected files remain listable.
 */
export function extractAiSessionIdFromFilePath( filePath: string ): string {
	const fileName = path.basename( filePath, SESSION_FILE_EXTENSION );
	const uuidMatch = fileName.match( SESSION_ID_REGEX );
	return uuidMatch?.[ 1 ] ?? fileName;
}
