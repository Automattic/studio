import { type ModelFavorite } from '@studio/common/lib/user-settings/model-favorites';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/data/app-messages';
import { useConnector, type UserPreferences } from '@/data/core';
import {
	USER_PREFERENCES_QUERY_KEY,
	useUserPreferences,
} from '@/data/queries/use-user-preferences';

export function useModelFavorites() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data } = useUserPreferences();
	const save = useMutation( {
		mutationKey: [ 'model-favorites' ],
		scope: { id: 'model-favorites' },
		mutationFn: ( favorites: ModelFavorite[] ) =>
			connector.setUserPreferences( { modelFavorites: favorites } ),
		onError: ( error ) => {
			toast.error( error instanceof Error ? error.message : String( error ) );
		},
		onSettled: () => {
			if ( queryClient.isMutating( { mutationKey: [ 'model-favorites' ] } ) === 1 )
				void queryClient.invalidateQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );
		},
	} );
	const update = ( favorites: ModelFavorite[] ) => {
		void queryClient.cancelQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );
		queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( previous ) =>
			previous ? { ...previous, modelFavorites: favorites } : previous
		);
		save.mutate( favorites );
	};
	return { favorites: data?.modelFavorites ?? [], update };
}
