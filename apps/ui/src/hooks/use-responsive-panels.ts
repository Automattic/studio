import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ALL_PANELS_MIN_WIDTH,
	getViewportWidth,
	PREVIEW_SPLIT_MIN_WIDTH,
	SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
} from '@/lib/resizable-panels';
import type { Connector } from '@/data/core/types';

// A programmatic window grow returns as soon as the main process resizes, but
// the renderer's matching `resize` event can land a beat later. Keep the
// collapse guard up for this long past the grow so a stale, still-narrow resize
// event can't collapse the panel we just opened. Comfortably longer than the
// event round-trip; short enough to feel instant.
const GROW_SETTLE_MS = 200;

interface UseResponsivePanelsOptions {
	connector: Pick< Connector, 'ensureWindowWidth' >;
	previewOpen: boolean;
	previewFullscreen: boolean;
	setPreviewOpen: ( open: boolean ) => void;
}

export function useResponsivePanels( {
	connector,
	previewOpen,
	previewFullscreen,
	setPreviewOpen,
}: UseResponsivePanelsOptions ) {
	const [ sidebarCollapsed, setSidebarCollapsed ] = useState(
		() => getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
	);
	const previewWidthArmedRef = useRef( false );
	const previousPreviewStateRef = useRef( { open: false, fullscreen: false } );
	// Ignore late completions when the user changes panel state while an IPC
	// resize request is in flight.
	const operationIdRef = useRef( 0 );
	// Non-zero while we are programmatically widening the window (opening a
	// panel). The native resize is async, so the window briefly still reports
	// its old, narrower width; without this guard the viewport watcher below
	// would read that stale width and collapse the panel we are opening.
	const growInFlightCountRef = useRef( 0 );
	const sidebarCollapsedRef = useRef( sidebarCollapsed );
	useEffect( () => {
		sidebarCollapsedRef.current = sidebarCollapsed;
	}, [ sidebarCollapsed ] );
	const ensureWindowWidth = useCallback(
		async ( minimumWidth: number ) => {
			try {
				return await connector.ensureWindowWidth( minimumWidth );
			} catch {
				return null;
			}
		},
		[ connector ]
	);

	// Level-triggered: collapse the sidebar whenever the live window width can no
	// longer give both the sidebar and the chat a usable width. Re-checking the
	// current width (rather than only reacting to the downward crossing) means a
	// collapse can never be "missed" and leave the sidebar stranded open at a
	// narrow width.
	const collapseSidebarIfViewportTooNarrow = useCallback( () => {
		if ( growInFlightCountRef.current > 0 || sidebarCollapsedRef.current ) {
			return;
		}
		if ( getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT ) {
			setSidebarCollapsed( true );
		}
	}, [] );

	// Drop the grow guard a beat after a grow resolves, then re-run the collapse
	// check: if the user narrowed the window during that settle window, honor it
	// now instead of leaving the sidebar stranded open.
	const releaseGrowGuardAfterSettle = useCallback( () => {
		window.setTimeout( () => {
			growInFlightCountRef.current -= 1;
			collapseSidebarIfViewportTooNarrow();
		}, GROW_SETTLE_MS );
	}, [ collapseSidebarIfViewportTooNarrow ] );

	useEffect( () => {
		const previous = previousPreviewStateRef.current;
		previousPreviewStateRef.current = { open: previewOpen, fullscreen: previewFullscreen };
		const enteringSplit =
			previewOpen && ! previewFullscreen && ( ! previous.open || previous.fullscreen );

		if ( ! previewOpen || previewFullscreen ) {
			previewWidthArmedRef.current = false;
			operationIdRef.current += 1;
		}
		if ( ! enteringSplit ) {
			return;
		}

		previewWidthArmedRef.current = false;
		const operationId = ++operationIdRef.current;
		const fitPreview = async () => {
			growInFlightCountRef.current += 1;
			try {
				let minimumWidth = sidebarCollapsed ? PREVIEW_SPLIT_MIN_WIDTH : ALL_PANELS_MIN_WIDTH;
				let actualWidth = await ensureWindowWidth( minimumWidth );
				if ( operationId !== operationIdRef.current ) {
					return;
				}

				if ( actualWidth !== null && actualWidth < minimumWidth && ! sidebarCollapsed ) {
					setSidebarCollapsed( true );
					minimumWidth = PREVIEW_SPLIT_MIN_WIDTH;
					actualWidth = await ensureWindowWidth( minimumWidth );
				}
				if (
					operationId === operationIdRef.current &&
					actualWidth !== null &&
					actualWidth < minimumWidth
				) {
					setPreviewOpen( false );
					return;
				}
				if ( operationId === operationIdRef.current && actualWidth !== null ) {
					previewWidthArmedRef.current = true;
				}
			} finally {
				releaseGrowGuardAfterSettle();
			}
		};

		void fitPreview();
	}, [
		ensureWindowWidth,
		previewFullscreen,
		previewOpen,
		releaseGrowGuardAfterSettle,
		setPreviewOpen,
		sidebarCollapsed,
	] );

	const openSidebar = useCallback( async () => {
		const operationId = ++operationIdRef.current;
		growInFlightCountRef.current += 1;
		try {
			const preservePreview = previewOpen;
			let actualWidth = await ensureWindowWidth(
				preservePreview ? ALL_PANELS_MIN_WIDTH : SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
			);
			if ( operationId !== operationIdRef.current ) {
				return;
			}

			if ( preservePreview && actualWidth !== null && actualWidth < ALL_PANELS_MIN_WIDTH ) {
				actualWidth = await ensureWindowWidth( SIDEBAR_AUTO_COLLAPSE_BREAKPOINT );
			}
			if (
				operationId === operationIdRef.current &&
				( actualWidth === null || actualWidth >= SIDEBAR_AUTO_COLLAPSE_BREAKPOINT )
			) {
				if ( preservePreview && actualWidth !== null && actualWidth < ALL_PANELS_MIN_WIDTH ) {
					setPreviewOpen( false );
				}
				setSidebarCollapsed( false );
			}
		} finally {
			releaseGrowGuardAfterSettle();
		}
	}, [ ensureWindowWidth, previewOpen, releaseGrowGuardAfterSettle, setPreviewOpen ] );

	// Opening a panel widens the window first and is shielded by
	// growInFlightCountRef, so this never fights the panel the user just asked
	// for; every other resize is a genuine user drag that should collapse the
	// sidebar once it no longer fits.
	useEffect( () => {
		window.addEventListener( 'resize', collapseSidebarIfViewportTooNarrow );
		return () => window.removeEventListener( 'resize', collapseSidebarIfViewportTooNarrow );
	}, [ collapseSidebarIfViewportTooNarrow ] );

	const onPreviewContainerWidthChange = useCallback(
		( width: number | null ) => {
			if ( ! previewOpen || previewFullscreen || width === null ) {
				previewWidthArmedRef.current = false;
				return;
			}
			if ( width >= PREVIEW_SPLIT_MIN_WIDTH ) {
				// A newly opened preview can briefly report its old compact width.
				// Only treat later shrinkage as an instruction to close it.
				previewWidthArmedRef.current = true;
				return;
			}
			if ( previewWidthArmedRef.current ) {
				previewWidthArmedRef.current = false;
				setPreviewOpen( false );
			}
		},
		[ previewFullscreen, previewOpen, setPreviewOpen ]
	);

	return {
		sidebarCollapsed,
		setSidebarCollapsed,
		openSidebar,
		onPreviewContainerWidthChange,
	};
}
