import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

// Opens the Send feedback dialog over the current screen.
export function useOpenFeedback() {
	const navigate = useNavigate();
	return useCallback(
		() =>
			void navigate( {
				to: '.',
				state: true,
				search: ( previous: Record< string, unknown > ) => ( { ...previous, feedback: true } ),
			} ),
		[ navigate ]
	);
}
