// Shared localStorage-backed Wapuu World high score for the browser connectors
// (local server + hosted), which have no Electron user-settings store. Keeps
// only the highest score, mirroring the desktop's saveWapuuScore behavior.

export function readWapuuScore( key: string ): number | undefined {
	const raw = window.localStorage.getItem( key );
	if ( raw === null ) return undefined;
	const parsed = Number( raw );
	return Number.isFinite( parsed ) ? parsed : undefined;
}

export function writeWapuuScore( key: string, score: number ): void {
	const current = readWapuuScore( key ) ?? 0;
	if ( score > current ) {
		window.localStorage.setItem( key, String( score ) );
	}
}
