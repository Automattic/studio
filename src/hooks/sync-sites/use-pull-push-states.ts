import { useCallback } from 'react';

export const generateStateId = ( selectedSiteId: string, remoteSiteId: number ) =>
	`${ selectedSiteId }-${ remoteSiteId }`;

export type States< T > = Record< string, T >;
export type UpdateState< T > = (
	selectedSiteId: string,
	remoteSiteId: number,
	state: Partial< T >
) => void;
export type GetState< T > = ( selectedSiteId: string, remoteSiteId: number ) => T | undefined;
export type ClearState = ( selectedSiteId: string, remoteSiteId: number ) => void;

export type UsePullPushStates< T > = {
	updateState: UpdateState< T >;
	getState: GetState< T >;
	clearState: ClearState;
};

export function usePullPushStates< T >(
	states: States< T >,
	setStates: React.Dispatch< React.SetStateAction< States< T > > >
): UsePullPushStates< T > {
	const updateState = useCallback< UpdateState< T > >(
		( selectedSiteId, remoteSiteId, state ) => {
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

	const getState = useCallback< GetState< T > >(
		( selectedSiteId, remoteSiteId ): T | undefined => {
			return states[ generateStateId( selectedSiteId, remoteSiteId ) ];
		},
		[ states ]
	);

	const clearState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
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
