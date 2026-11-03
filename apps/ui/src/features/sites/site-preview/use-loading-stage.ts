import { useCallback, useEffect, useState } from 'react';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';

// A site that was just started keeps its loading stage over the preview
// until the first page arrives. `reveal` reports that page.
export function useLoadingStage( {
	siteId,
	live,
	canPreview,
	isStarting,
	rendered,
}: {
	siteId: string;
	live: boolean;
	canPreview: boolean;
	isStarting: boolean;
	// The design system or the site's email is on screen, which Studio renders
	// without a page load.
	rendered: boolean;
} ) {
	const [ awaitingReveal, setAwaitingReveal ] = useState( false );
	useEffect( () => {
		if ( isStarting ) {
			setAwaitingReveal( true );
		} else if ( ! canPreview ) {
			setAwaitingReveal( false );
		}
	}, [ canPreview, isStarting ] );
	const loadingStage = isStarting || ( awaitingReveal && ! rendered );
	const setRevealing = useOptionalSessionPreviewUI()?.setRevealing;
	useEffect( () => {
		if ( live || ! setRevealing ) {
			return;
		}
		setRevealing( siteId, loadingStage );
		return () => setRevealing( siteId, false );
	}, [ live, loadingStage, setRevealing, siteId ] );
	const reveal = useCallback( () => setAwaitingReveal( false ), [] );
	return { loadingStage, reveal };
}
