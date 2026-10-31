import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useStartSite } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { useMediaQuery } from '@/lib/hooks';

/** Explicit starts reveal the preview and apply the site-start layout preference. */
export function useStartSiteWithChat() {
	const start = useStartSite();
	const { data: preferences } = useUserPreferences();
	const preview = useOptionalSessionPreviewUI();
	const narrow = useMediaQuery( '(max-width: 540px)' );
	const navigate = useNavigate();
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const revealPreview = ( siteId: string ) => {
		const openChat = preferences?.openChatOnSiteStart ?? true;
		preview?.setSite( siteId );
		preview?.setOpen( true, { instant: true } );
		preview?.setChatHidden( narrow || ! openChat, siteId );
		if ( openChat && pathname === `/sites/${ encodeURIComponent( siteId ) }` ) {
			void navigate( { to: '/sites/$siteId/new', params: { siteId } } );
		}
	};
	return {
		...start,
		mutate: ( ...args: Parameters< typeof start.mutate > ) => {
			revealPreview( args[ 0 ] );
			start.mutate( ...args );
		},
		mutateAsync: ( ...args: Parameters< typeof start.mutateAsync > ) => {
			revealPreview( args[ 0 ] );
			return start.mutateAsync( ...args );
		},
	};
}
