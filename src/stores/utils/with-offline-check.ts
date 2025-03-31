import { useOffline } from 'src/hooks/use-offline';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { TypedUseQuery } from '@reduxjs/toolkit/query/react';

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
