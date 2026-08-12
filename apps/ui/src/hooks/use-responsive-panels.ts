import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ALL_PANELS_MIN_WIDTH,
	getViewportWidth,
	PREVIEW_SPLIT_MIN_WIDTH,
	SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
} from '@/lib/resizable-panels';
import type { Connector } from '@/data/core/types';

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
			}
		};

		void fitPreview();
	}, [ ensureWindowWidth, previewFullscreen, previewOpen, setPreviewOpen, sidebarCollapsed ] );

	const openSidebar = useCallback( async () => {
		const operationId = ++operationIdRef.current;
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
	}, [ ensureWindowWidth, previewOpen, setPreviewOpen ] );

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
