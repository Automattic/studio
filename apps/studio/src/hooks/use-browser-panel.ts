import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useRootSelector } from 'src/stores';

export interface BrowserTab {
	id: string;
	displayUrl: string;
	title: string;
	isLoading: boolean;
	isInitialLoad: boolean;
}

const MAX_TABS = 8;

function createTab( displayUrl: string ): BrowserTab {
	return {
		id: crypto.randomUUID(),
		displayUrl,
		title: '',
		isLoading: false,
		isInitialLoad: true,
	};
}

export function useBrowserPanel() {
	const { selectedSite, sites } = useSiteDetails();
	const selectedTaskId = useRootSelector( ( state ) => state.tasks.selectedTaskId );
	const selectedTask = useRootSelector( ( state ) =>
		state.tasks.tasks.find( ( t ) => t.id === state.tasks.selectedTaskId )
	);

	const [ tabs, setTabs ] = useState< BrowserTab[] >( [] );
	const [ activeTabId, setActiveTabId ] = useState( '' );
	const iframeElements = useRef( new Map< string, HTMLIFrameElement | null >() );
	const navigatingRefs = useRef( new Map< string, boolean >() );

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

	// Reset tabs when site changes
	useEffect( () => {
		if ( siteUrl ) {
			const initialTab = createTab( siteUrl );
			setTabs( [ initialTab ] );
			setActiveTabId( initialTab.id );
			iframeElements.current.clear();
			navigatingRefs.current.clear();
		} else {
			setTabs( [] );
			setActiveTabId( '' );
		}
	}, [ siteUrl ] );

	// Derive active tab
	const activeTab = tabs.find( ( t ) => t.id === activeTabId ) ?? null;

	// Update a specific tab's properties
	const updateTab = useCallback( ( tabId: string, updates: Partial< BrowserTab > ) => {
		setTabs( ( prev ) => prev.map( ( t ) => ( t.id === tabId ? { ...t, ...updates } : t ) ) );
	}, [] );

	// Register/unregister iframe element for a tab
	const setIframeRef = useCallback( ( tabId: string, el: HTMLIFrameElement | null ) => {
		if ( el ) {
			iframeElements.current.set( tabId, el );
		} else {
			iframeElements.current.delete( tabId );
		}
	}, [] );

	// Handle iframe load for a specific tab
	const handleIframeLoad = useCallback(
		( tabId: string ) => {
			navigatingRefs.current.set( tabId, false );

			const iframe = iframeElements.current.get( tabId );
			const updates: Partial< BrowserTab > = {
				isInitialLoad: false,
				isLoading: false,
			};

			try {
				const currentUrl = iframe?.contentWindow?.location.href;
				if ( currentUrl ) {
					updates.displayUrl = currentUrl;
				}
			} catch {
				// Cross-origin restriction
			}

			try {
				const docTitle = iframe?.contentDocument?.title;
				if ( docTitle ) {
					updates.title = docTitle;
				}
			} catch {
				// Cross-origin restriction
			}

			updateTab( tabId, updates );
		},
		[ updateTab ]
	);

	// Handle beforeunload for a specific tab (link click detected)
	const handleBeforeUnload = useCallback(
		( tabId: string ) => {
			if ( ! navigatingRefs.current.get( tabId ) ) {
				navigatingRefs.current.set( tabId, true );
				updateTab( tabId, { isLoading: true } );
			}
		},
		[ updateTab ]
	);

	// Create a new tab at the site homepage
	const addTab = useCallback( () => {
		if ( ! siteUrl || tabs.length >= MAX_TABS ) {
			return;
		}
		const newTab = createTab( siteUrl );
		setTabs( ( prev ) => [ ...prev, newTab ] );
		setActiveTabId( newTab.id );
	}, [ siteUrl, tabs.length ] );

	// Close a tab, activating its neighbor
	const closeTab = useCallback(
		( tabId: string ) => {
			if ( tabs.length <= 1 ) {
				return;
			}
			const tabIndex = tabs.findIndex( ( t ) => t.id === tabId );
			if ( tabIndex === -1 ) {
				return;
			}
			const newTabs = tabs.filter( ( t ) => t.id !== tabId );
			iframeElements.current.delete( tabId );
			navigatingRefs.current.delete( tabId );

			if ( tabId === activeTabId ) {
				const newActiveIndex = Math.max( 0, tabIndex - 1 );
				setActiveTabId( newTabs[ newActiveIndex ].id );
			}

			setTabs( newTabs );
		},
		[ tabs, activeTabId ]
	);

	// Switch to a tab, syncing its URL from the iframe
	const selectTab = useCallback(
		( tabId: string ) => {
			setActiveTabId( tabId );
			const iframe = iframeElements.current.get( tabId );
			try {
				const url = iframe?.contentWindow?.location.href;
				if ( url ) {
					updateTab( tabId, { displayUrl: url } );
				}
			} catch {
				// Cross-origin restriction
			}
		},
		[ updateTab ]
	);

	// Navigation handlers — operate on the active tab
	const handleBack = useCallback( () => {
		try {
			iframeElements.current.get( activeTabId )?.contentWindow?.history.back();
		} catch {
			// Cross-origin restriction
		}
	}, [ activeTabId ] );

	const handleForward = useCallback( () => {
		try {
			iframeElements.current.get( activeTabId )?.contentWindow?.history.forward();
		} catch {
			// Cross-origin restriction
		}
	}, [ activeTabId ] );

	const handleReload = useCallback( () => {
		const iframe = iframeElements.current.get( activeTabId );
		if ( iframe && autoLoginSrc ) {
			updateTab( activeTabId, { isLoading: true } );
			iframe.src = autoLoginSrc;
		}
	}, [ activeTabId, autoLoginSrc, updateTab ] );

	const handleNavigate = useCallback(
		( url: string ) => {
			const iframe = iframeElements.current.get( activeTabId );
			if ( ! iframe ) {
				return;
			}
			let normalizedUrl = url.trim();
			if ( normalizedUrl && ! /^https?:\/\//.test( normalizedUrl ) ) {
				normalizedUrl = `http://${ normalizedUrl }`;
			}
			if ( normalizedUrl ) {
				updateTab( activeTabId, { isLoading: true, displayUrl: normalizedUrl } );
				iframe.src = normalizedUrl;
			}
		},
		[ activeTabId, updateTab ]
	);

	const setDisplayUrl = useCallback(
		( url: string ) => {
			if ( activeTabId ) {
				updateTab( activeTabId, { displayUrl: url } );
			}
		},
		[ activeTabId, updateTab ]
	);

	// Listen for agent-initiated browser navigation (targets active tab)
	useEffect( () => {
		const handler = ( e: Event ) => {
			const { siteId, url } = ( e as CustomEvent ).detail;
			const iframe = iframeElements.current.get( activeTabId );
			if ( resolvedSite?.id === siteId && iframe ) {
				updateTab( activeTabId, { isLoading: true, displayUrl: url } );
				iframe.src = url;
			}
		};
		window.addEventListener( 'studio:browser-navigate', handler );
		return () => window.removeEventListener( 'studio:browser-navigate', handler );
	}, [ resolvedSite?.id, activeTabId, updateTab ] );

	// Keyboard shortcuts: Cmd+Shift+[ and Cmd+Shift+] to switch tabs
	useEffect( () => {
		const handler = ( e: KeyboardEvent ) => {
			const mod = e.metaKey || e.ctrlKey;
			if ( ! mod || ! e.shiftKey || tabs.length < 2 ) {
				return;
			}

			const currentIndex = tabs.findIndex( ( t ) => t.id === activeTabId );
			if ( currentIndex === -1 ) {
				return;
			}

			if ( e.key === '[' ) {
				e.preventDefault();
				const prevIndex = ( currentIndex - 1 + tabs.length ) % tabs.length;
				selectTab( tabs[ prevIndex ].id );
			} else if ( e.key === ']' ) {
				e.preventDefault();
				const nextIndex = ( currentIndex + 1 ) % tabs.length;
				selectTab( tabs[ nextIndex ].id );
			}
		};
		window.addEventListener( 'keydown', handler );
		return () => window.removeEventListener( 'keydown', handler );
	}, [ tabs, activeTabId, selectTab ] );

	return {
		// Tab management
		tabs,
		activeTabId,
		activeTab,
		selectTab,
		addTab,
		closeTab,
		canAddTab: tabs.length < MAX_TABS,

		// Iframe management (for BrowserIframeContainer)
		setIframeRef,
		handleIframeLoad,
		handleBeforeUnload,
		autoLoginSrc,

		// Navigation (operates on active tab)
		displayUrl: activeTab?.displayUrl ?? '',
		setDisplayUrl,
		handleBack,
		handleForward,
		handleReload,
		handleNavigate,

		// Site info
		siteUrl,
		siteName,

		// Active tab state (for toolbar compatibility)
		isInitialLoad: activeTab?.isInitialLoad ?? true,
		isNavigating: activeTab?.isLoading ?? false,
	};
}
