import { useCallback, useEffect, useState } from 'react';

export type SubmitFeedback = 'shake' | 'error' | null;

// A blocked send shakes the notice, then holds it in the error color briefly.
const SUBMIT_SHAKE_MS = 240;
const SUBMIT_FEEDBACK_MS = 900;

export function useSubmitFeedback() {
	const [ feedback, setFeedback ] = useState< SubmitFeedback >( null );

	useEffect( () => {
		if ( feedback === null ) {
			return;
		}
		const timer = window.setTimeout(
			() => setFeedback( feedback === 'shake' ? 'error' : null ),
			feedback === 'shake' ? SUBMIT_SHAKE_MS : SUBMIT_FEEDBACK_MS - SUBMIT_SHAKE_MS
		);
		return () => window.clearTimeout( timer );
	}, [ feedback ] );

	const shake = useCallback( () => setFeedback( 'shake' ), [] );
	return { feedback, shake };
}
