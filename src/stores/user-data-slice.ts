import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState, store } from 'src/stores';
import type { UserData } from 'src/storage/storage-types';

interface UserDataState extends UserData {
	isLoading: boolean;
	error: string | null;
}

const initialState: UserDataState = {
	sites: [],
	snapshots: [],
	isLoading: false,
	error: null,
};

const userDataSlice = createSlice( {
	name: 'userData',
	initialState,
	reducers: {
		setUserData: ( state, action: PayloadAction< UserData > ) => {
			return {
				...state,
				...action.payload,
				isLoading: false,
				error: null,
			};
		},
		setLoading: ( state, action: PayloadAction< boolean > ) => {
			state.isLoading = action.payload;
		},
		setError: ( state, action: PayloadAction< string > ) => {
			state.error = action.payload;
			state.isLoading = false;
		},
	},
} );

window.ipcListener.subscribe( 'user-data-updated', ( _, payload ) => {
	store.dispatch( setUserData( payload ) );
} );

window.ipcListener.subscribe( 'user-data-error', ( _, payload ) => {
	store.dispatch( setError( payload ) );
} );

export const { setUserData, setLoading, setError } = userDataSlice.actions;
export const { reducer: userDataReducer } = userDataSlice;

export const selectSnapshots = ( state: RootState, userId: number, siteId?: string ) => {
	const snapshots = state.userData.snapshots ?? [];
	let filtered = snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteId ) {
		filtered = filtered.filter( ( snapshot ) => snapshot.localSiteId === siteId );
	}

	return filtered;
};
