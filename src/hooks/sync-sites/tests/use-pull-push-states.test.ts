import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import {
	usePullPushStates,
	generateStateId,
	type States,
} from 'src/hooks/sync-sites/use-pull-push-states';

type TestState = {
	status: { key: string };
	value: string;
};

function useStatesWrapper( initial: States< TestState > = {} ) {
	const [ states, setStates ] = useState< States< TestState > >( initial );
	const helpers = usePullPushStates< TestState >( states, setStates );
	return { states, ...helpers };
}

describe( 'usePullPushStates', () => {
	describe( 'updateState', () => {
		it( 'should merge partial state into an existing entry', () => {
			const key = generateStateId( 'site-1', 100 );
			const initial: States< TestState > = {
				[ key ]: { status: { key: 'in-progress' }, value: 'original' },
			};
			const { result } = renderHook( () => useStatesWrapper( initial ) );

			act( () => {
				result.current.updateState( 'site-1', 100, { value: 'updated' } );
			} );

			expect( result.current.states[ key ] ).toEqual( {
				status: { key: 'in-progress' },
				value: 'updated',
			} );
		} );

		it( 'should create entry with partial state when key does not exist', () => {
			const { result } = renderHook( () => useStatesWrapper() );

			act( () => {
				result.current.updateState( 'site-1', 100, { value: 'partial' } );
			} );

			const key = generateStateId( 'site-1', 100 );
			// Entry is created but status is undefined - callers must handle this
			expect( result.current.states[ key ] ).toBeDefined();
			expect( result.current.states[ key ].status ).toBeUndefined();
		} );
	} );

	describe( 'clearState', () => {
		it( 'should remove an existing entry', () => {
			const key = generateStateId( 'site-1', 100 );
			const initial: States< TestState > = {
				[ key ]: { status: { key: 'in-progress' }, value: 'test' },
			};
			const { result } = renderHook( () => useStatesWrapper( initial ) );

			act( () => {
				result.current.clearState( 'site-1', 100 );
			} );

			expect( result.current.states[ key ] ).toBeUndefined();
		} );
	} );

	describe( 'getState', () => {
		it( 'should return the state for a given key', () => {
			const key = generateStateId( 'site-1', 100 );
			const state = { status: { key: 'in-progress' }, value: 'test' };
			const initial: States< TestState > = { [ key ]: state };
			const { result } = renderHook( () => useStatesWrapper( initial ) );

			expect( result.current.getState( 'site-1', 100 ) ).toEqual( state );
		} );

		it( 'should return undefined for a non-existent key', () => {
			const { result } = renderHook( () => useStatesWrapper() );
			expect( result.current.getState( 'site-1', 100 ) ).toBeUndefined();
		} );
	} );
} );
