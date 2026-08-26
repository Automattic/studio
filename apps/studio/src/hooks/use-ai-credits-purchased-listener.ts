import { useCallback } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { wpcomApi } from 'src/stores/wpcom-api';

/**
 * Returns the user to their AI credits after a WordPress.com checkout sends
 * them back via wp-studio://ai-credits-purchased. The balance lives in the
 * Account tab, and the quota is cached for an hour with nothing refetching it
 * while Studio sits behind the browser, so it has to be invalidated explicitly.
 */
export function useAiCreditsPurchasedListener() {
	const dispatch = useAppDispatch();

	useIpcListener(
		'ai-credits-purchased',
		useCallback( () => {
			dispatch( wpcomApi.util.invalidateTags( [ 'StudioAssistantQuota' ] ) );
			void getIpcApi().showUserSettings( 'account' );
		}, [ dispatch ] )
	);
}
