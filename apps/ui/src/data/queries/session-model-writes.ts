const pendingWrites = new Map< string, Promise< void > >();

// A chat can send or drain its queue from outside the composer. Serialize its
// model changes and let every send wait for the selected preset to reach disk.
export function queueSessionModelWrite( sessionId: string, write: () => Promise< void > ) {
	const previous = pendingWrites.get( sessionId ) ?? Promise.resolve();
	const next = previous.catch( () => undefined ).then( write );
	pendingWrites.set( sessionId, next );
	void next.then(
		() => {
			if ( pendingWrites.get( sessionId ) === next ) pendingWrites.delete( sessionId );
		},
		() => undefined
	);
	return next;
}

export async function waitForSessionModelWrites( sessionId: string ) {
	let pending = pendingWrites.get( sessionId );
	while ( pending ) {
		await pending;
		const latest = pendingWrites.get( sessionId );
		if ( latest === pending ) return;
		pending = latest;
	}
}

export function clearFailedSessionModelWrite( sessionId: string, write: Promise< void > ) {
	if ( pendingWrites.get( sessionId ) === write ) pendingWrites.delete( sessionId );
}
