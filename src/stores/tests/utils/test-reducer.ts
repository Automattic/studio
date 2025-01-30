import { Action } from '@reduxjs/toolkit';
import { RootState, rootReducer } from 'src/stores';

const initialState = rootReducer( undefined, { type: '@@INIT' } );

// This reducer adds an action to reset the state to its initial value. This is useful for testing.
export function testReducer( state: RootState | undefined, action: Action ) {
	if ( action.type === 'test/resetState' ) {
		return initialState;
	}

	return rootReducer( state, action );
}

export const testActions = {
	resetState: () => {
		return { type: 'test/resetState' };
	},
};
