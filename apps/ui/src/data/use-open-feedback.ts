import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useConnector } from '@/data/core';

// Opens the Send feedback dialog over the current screen; undefined where the
// connector can't send feedback.
export function useOpenFeedback() {
	const navigate = useNavigate();
	const canSend = !! useConnector().sendFeedback;
	const open = useCallback(
		() =>
			void navigate( {
				to: '.',
				state: true,
				search: ( previous: Record< string, unknown > ) => ( { ...previous, feedback: true } ),
			} ),
		[ navigate ]
	);
	return canSend ? open : undefined;
}
