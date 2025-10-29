import { useOffline } from 'src/hooks/use-offline';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { TypedUseQuery, TypedUseMutation } from '@reduxjs/toolkit/query/react';

export function withOfflineCheck< TResult, TArg, TBaseQuery extends BaseQueryFn >(
	useQueryHook: TypedUseQuery< TResult, TArg, TBaseQuery >
): TypedUseQuery< TResult, TArg, TBaseQuery > {
	return ( arg, options = {} ) => {
		const isOffline = useOffline();
		return useQueryHook( arg, {
			...options,
			skip: isOffline || options?.skip,
		} );
	};
}

export function withOfflineCheckMutation< TResult, TArg, TBaseQuery extends BaseQueryFn >(
	useMutationHook: TypedUseMutation< TResult, TArg, TBaseQuery >
): TypedUseMutation< TResult, TArg, TBaseQuery > {
	return ( options = {} ) => {
		const isOffline = useOffline();
		const [ trigger, result ] = useMutationHook( options );

		const wrappedTrigger = ( ( ...args: Parameters< typeof trigger > ) => {
			if ( isOffline ) {
				return Promise.reject( new Error( 'Cannot perform mutation while offline' ) ) as ReturnType<
					typeof trigger
				>;
			}
			return trigger( ...args );
		} ) as typeof trigger;

		return [ wrappedTrigger, result ] as const;
	};
}
