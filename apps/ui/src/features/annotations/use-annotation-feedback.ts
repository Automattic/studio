import { useEffect, useRef } from 'react';
import { useSubmitFeedback } from '@/lib/hooks';

export const ANNOTATION_SHAKE_MS = 360;

export function useAnnotationFeedback( attempt: number | undefined, enabled: boolean ) {
	const { feedback, shake } = useSubmitFeedback( ANNOTATION_SHAKE_MS );
	const previous = useRef( attempt );
	useEffect( () => {
		if ( attempt !== previous.current ) {
			previous.current = attempt;
			if ( enabled ) shake();
		}
	}, [ attempt, enabled, shake ] );
	return enabled ? feedback : null;
}
