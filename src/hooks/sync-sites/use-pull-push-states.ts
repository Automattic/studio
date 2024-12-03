import { useCallback } from 'react';

export const generateStateId = ( selectedSiteId: string, remoteSiteId: number ) =>
	`${ selectedSiteId }-${ remoteSiteId }`;

export function usePullPushStates< T >(
	states: Record< string, T >,
	setStates: React.Dispatch< React.SetStateAction< Record< string, T > > >
) {
	const updateState = useCallback(
		( selectedSiteId: string, remoteSiteId: number, state: Partial< T > ) => {
			setStates( ( prevStates ) => ( {
				...prevStates,
				[ generateStateId( selectedSiteId, remoteSiteId ) ]: {
					...prevStates[ generateStateId( selectedSiteId, remoteSiteId ) ],
					...state,
				},
			} ) );
		},
		[ setStates ]
	);

	const getState = useCallback(
		( selectedSiteId: string, remoteSiteId: number ): T | undefined => {
			return states[ generateStateId( selectedSiteId, remoteSiteId ) ];
		},
		[ states ]
	);

	const clearState = useCallback(
		( selectedSiteId: string, remoteSiteId: number ) => {
			setStates( ( prevStates ) => {
				const newStates = { ...prevStates };
				delete newStates[ generateStateId( selectedSiteId, remoteSiteId ) ];
				return newStates;
			} );
		},
		[ setStates ]
	);

	return { updateState, getState, clearState };
}
