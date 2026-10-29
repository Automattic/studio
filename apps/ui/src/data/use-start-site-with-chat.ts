import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useStartSite } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';

/** Start controls open chat; background starts keep the current workspace. */
export function useStartSiteWithChat() {
	const start = useStartSite();
	const { data: preferences } = useUserPreferences();
	const preview = useOptionalSessionPreviewUI();
	const navigate = useNavigate();
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const openChat = ( siteId: string ) => {
		if ( ! ( preferences?.openChatOnSiteStart ?? true ) ) return;
		preview?.setChatHidden( false, siteId );
		if ( pathname === `/sites/${ encodeURIComponent( siteId ) }` ) {
			void navigate( { to: '/sites/$siteId/new', params: { siteId } } );
		}
	};
	return {
		...start,
		mutate: ( ...args: Parameters< typeof start.mutate > ) => {
			openChat( args[ 0 ] );
			start.mutate( ...args );
		},
		mutateAsync: ( ...args: Parameters< typeof start.mutateAsync > ) => {
			openChat( args[ 0 ] );
			return start.mutateAsync( ...args );
		},
	};
}
