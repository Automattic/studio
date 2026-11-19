/**
 * Whether remote mode is on: `studio remote` and the desktop app's Settings > Phone. It is
 * opt-in while it is a proof of concept: set `STUDIO_ENABLE_REMOTE_MODE` in the environment of
 * the CLI or of the Studio app.
 */
export function isRemoteModeEnabled(): boolean {
	return Boolean( process.env.STUDIO_ENABLE_REMOTE_MODE );
}
