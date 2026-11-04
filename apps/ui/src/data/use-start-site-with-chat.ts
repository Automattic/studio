import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useStartSite } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';

/** Explicit starts reveal the site’s workspace. */
export function useStartSiteWithChat() {
	const start = useStartSite();
	const preview = useOptionalSessionPreviewUI();
	const navigate = useNavigate();
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const revealPreview = ( siteId: string ) => {
		preview?.setSite( siteId );
		preview?.setOpen( true, { siteId } );
		if ( pathname === `/sites/${ encodeURIComponent( siteId ) }` ) {
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
