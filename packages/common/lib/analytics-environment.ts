// Test runners, CI jobs and E2E runs start Studio with a fresh config each time, so whatever they
// send counts as a new install. Both analytics senders (Tracks and MC Stats) refuse to send from
// them. `VITEST` covers unit tests even when the machine already sets `NODE_ENV`, which keeps
// Vitest from setting it to `test`.
export function isAutomatedRun(): boolean {
	return Boolean(
		process.env.VITEST || process.env.CI || process.env.E2E || process.env.NODE_ENV === 'test'
	);
}
