export interface StudioToolProgressUpdate {
	studioProgress: {
		message: string;
		update?: boolean;
	};
}

export function getStudioToolProgress(
	partialResult: unknown
): StudioToolProgressUpdate[ 'studioProgress' ] | null {
	const details = ( partialResult as { details?: unknown } | null )?.details;
	const progress = ( details as Partial< StudioToolProgressUpdate > | null )?.studioProgress;
	if ( ! progress || typeof progress.message !== 'string' ) {
		return null;
	}
	return progress;
}
