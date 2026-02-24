/**
 * Returns true when stdin is a TTY (direct terminal usage).
 * Returns false when stdin is piped, redirected, or set to 'ignore'
 * (e.g., when forked by the desktop app).
 */
export function isInteractive(): boolean {
	return Boolean( process.stdin.isTTY );
}
