import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';

export function useOpenGettingStarted() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const { mutateAsync: setHints, isPending } = useSetOnboardingHints();
	const preview = useOptionalSessionPreviewUI();
	const siteId = sites?.find( ( site ) => site.id === preview?.siteId )?.id ?? sites?.[ 0 ]?.id;
	const setChatHidden = preview?.setChatHidden;

	const open = useCallback( async () => {
		if ( ! sites || isPending ) return;
		await setHints( {
			walkthroughStep: siteId ? 'intro' : 'create',
			annotateHintDismissed: false,
		} );
		if ( siteId ) {
			setChatHidden?.( false, siteId );
			await navigate( { to: '/sites/$siteId/new', params: { siteId }, search: {} } );
		} else {
			await navigate( { to: '/sites', search: { addSite: 'create' } } );
		}
	}, [ sites, siteId, isPending, setHints, setChatHidden, navigate ] );

	return { open, isPending };
}
