import { useCallback, useRef, useEffect } from 'react';

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

type UsePullPushStates< T > = {
	updateState: UpdateState< T >;
	getState: GetState< T >;
	clearState: ClearState;
};

export function usePullPushStates< T >(
	states: States< T >,
	setStates: React.Dispatch< React.SetStateAction< States< T > > >
): UsePullPushStates< T > {
	const statesRef = useRef( states );

	useEffect( () => {
		statesRef.current = states;
	}, [ states ] );

	const updateState = useCallback< UpdateState< T > >(
		( selectedSiteId, remoteSiteId, state ) => {
			setStates( ( prevStates ) => {
				const newStates = {
					...prevStates,
					[ generateStateId( selectedSiteId, remoteSiteId ) ]: {
						...prevStates[ generateStateId( selectedSiteId, remoteSiteId ) ],
						...state,
					},
				};
				statesRef.current = newStates;
				return newStates;
			} );
		},
		[ setStates ]
	);

	const getState = useCallback< GetState< T > >(
		( selectedSiteId, remoteSiteId ): T | undefined => {
			return statesRef.current[ generateStateId( selectedSiteId, remoteSiteId ) ];
		},
		[]
	);

	const clearState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			setStates( ( prevStates ) => {
				const newStates = { ...prevStates };
				delete newStates[ generateStateId( selectedSiteId, remoteSiteId ) ];
				statesRef.current = newStates;
				return newStates;
			} );
		},
		[ setStates ]
	);

	return { updateState, getState, clearState };
}
