// Matches the condition the Tracks core uses to log instead of send. Never true in a packaged build.
export function isDevRun(): boolean {
	return process.env.NODE_ENV === 'development' || Boolean( process.env.STUDIO_DEBUG_TRACKS );
}
