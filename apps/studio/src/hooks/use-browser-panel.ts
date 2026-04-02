import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useRootSelector } from 'src/stores';

export function useBrowserPanel() {
	const { selectedSite, sites } = useSiteDetails();
	const selectedTaskId = useRootSelector( ( state ) => state.tasks.selectedTaskId );
	const selectedTask = useRootSelector( ( state ) =>
		state.tasks.tasks.find( ( t ) => t.id === state.tasks.selectedTaskId )
	);

	const iframeRef = useRef< HTMLIFrameElement >( null );
	const [ displayUrl, setDisplayUrl ] = useState( '' );
	const [ isInitialLoad, setIsInitialLoad ] = useState( true );
	const [ isNavigating, setIsNavigating ] = useState( false );
	const navigatingRef = useRef( false );

	// Resolve which site to show: task's site or selected site
	const resolvedSite =
		selectedTaskId && selectedTask
			? sites.find( ( s ) => s.id === selectedTask.siteId ) ?? null
			: selectedSite;

	const siteUrl = resolvedSite?.running ? resolvedSite.url : undefined;
	const siteName = resolvedSite?.name ?? '';

	// Build an auto-login URL that redirects to the site homepage
	const autoLoginSrc = useMemo( () => {
		if ( ! siteUrl ) {
			return undefined;
		}
		const url = new URL( '/studio-auto-login', siteUrl );
		url.searchParams.append( 'redirect_to', siteUrl );
		return url.toString();
	}, [ siteUrl ] );

	// Reset to initial load when the site changes
	useEffect( () => {
		if ( autoLoginSrc ) {
			setIsInitialLoad( true );
			setIsNavigating( false );
		}
	}, [ autoLoginSrc ] );

	// Listen for in-iframe link clicks to show the progress bar
	useEffect( () => {
		const iframe = iframeRef.current;
		if ( ! iframe ) {
			return;
		}

		const handleBeforeUnload = () => {
			if ( ! navigatingRef.current ) {
				navigatingRef.current = true;
				setIsNavigating( true );
			}
		};

		const attachListener = () => {
			try {
				iframe.contentWindow?.addEventListener( 'beforeunload', handleBeforeUnload );
			} catch {
				// Cross-origin restriction
			}
		};

		iframe.addEventListener( 'load', attachListener );
		attachListener();

		return () => {
			iframe.removeEventListener( 'load', attachListener );
			try {
				iframe.contentWindow?.removeEventListener( 'beforeunload', handleBeforeUnload );
			} catch {
				// Cross-origin restriction
			}
		};
	}, [ autoLoginSrc ] );

	const handleIframeLoad = useCallback( () => {
		setIsInitialLoad( false );
		setIsNavigating( false );
		navigatingRef.current = false;

		// Update the displayed URL from the iframe's actual location
		try {
			const currentUrl = iframeRef.current?.contentWindow?.location.href;
			if ( currentUrl ) {
				setDisplayUrl( currentUrl );
			}
		} catch {
			// Cross-origin restriction
		}
	}, [] );

	// Sync displayUrl when the resolved site URL changes
	useEffect( () => {
		if ( siteUrl ) {
			setDisplayUrl( siteUrl );
		} else {
			setDisplayUrl( '' );
		}
	}, [ siteUrl ] );

	const handleBack = useCallback( () => {
		try {
			iframeRef.current?.contentWindow?.history.back();
		} catch {
			// Cross-origin restriction
		}
	}, [] );

	const handleForward = useCallback( () => {
		try {
			iframeRef.current?.contentWindow?.history.forward();
		} catch {
			// Cross-origin restriction
		}
	}, [] );

	const handleReload = useCallback( () => {
		if ( iframeRef.current && autoLoginSrc ) {
			setIsNavigating( true );
			iframeRef.current.src = autoLoginSrc;
		}
	}, [ autoLoginSrc ] );

	const handleNavigate = useCallback( ( url: string ) => {
		if ( ! iframeRef.current ) {
			return;
		}
		let normalizedUrl = url.trim();
		if ( normalizedUrl && ! /^https?:\/\//.test( normalizedUrl ) ) {
			normalizedUrl = `http://${ normalizedUrl }`;
		}
		if ( normalizedUrl ) {
			setIsNavigating( true );
			iframeRef.current.src = normalizedUrl;
			setDisplayUrl( normalizedUrl );
		}
	}, [] );

	return {
		iframeRef,
		autoLoginSrc,
		isInitialLoad,
		isNavigating,
		handleIframeLoad,
		siteUrl,
		displayUrl,
		setDisplayUrl,
		siteName,
		handleBack,
		handleForward,
		handleReload,
		handleNavigate,
	};
}
