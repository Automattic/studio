import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import {
	getInitialPreviewLayout,
	getPreviewSplitLayout,
	getViewportWidth,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	PREVIEW_PANEL_MIN_WIDTH,
	PREVIEW_PANEL_STORAGE_KEY,
	removeStoredResizablePanelWidth,
	storeResizablePanelWidth,
} from '@/lib/resizable-panels';
import type { KeyboardEvent, MouseEventHandler, RefObject } from 'react';

interface UsePreviewSplitOptions {
	showPreview: boolean;
}

interface PreviewSplitHandleProps {
	minWidth: number;
	maxWidth: number;
	width: number;
	isResizing: boolean;
	onResizeStart: MouseEventHandler< HTMLElement >;
	onKeyDown: ( event: KeyboardEvent< HTMLElement > ) => void;
}

interface UsePreviewSplitResult {
	rootRef: RefObject< HTMLDivElement | null >;
	// The value for the --preview-frame-content-width CSS var: a px width once
	// measured, or a `calc(100% - <legacy>px)` fallback that reserves preview
	// space before the first measurement.
	contentWidthVar: string;
	isResizing: boolean;
	handleProps: PreviewSplitHandleProps;
}

// Owns the preview/content split: a single clamp (getPreviewSplitLayout) feeds
// both the rendered content width and the resize handle's reported bounds, so
// CSS never re-clamps. Keeps two state atoms — the user's preferred content
// width (persisted) and the measured container width — and derives everything
// else. Also owns the legacy preview-width -> content-width migration.
export function usePreviewSplit( { showPreview }: UsePreviewSplitOptions ): UsePreviewSplitResult {
	const rootRef = useRef< HTMLDivElement >( null );
	const [ initialLayout ] = useState( () => getInitialPreviewLayout( getViewportWidth() ) );
	const legacyPreviewWidth = initialLayout.legacyPreviewWidth;

	// `preferredContentWidth` is the user's intent (persisted); the displayed
	// width is always re-derived from it against the current container, never
	// stored back. Recomputing from a previously-clamped displayed value would
	// lose the intent on shrink-then-grow.
	const [ preferredContentWidth, setPreferredContentWidth ] = useState< number | null >(
		initialLayout.contentWidth
	);
	const [ containerWidth, setContainerWidth ] = useState< number | null >( null );
	// Mirrors preferredContentWidth so event handlers read the latest value
	// without re-subscribing. setPreferred is the only writer of the state, and
	// it updates this ref in lockstep, so the two never drift.
	const preferredRef = useRef( preferredContentWidth );
	const hasLegacyPreviewWidthRef = useRef( initialLayout.hasLegacyPreviewWidth );

	const measureRootWidth = useCallback( () => {
		const width = rootRef.current?.getBoundingClientRect().width;
		if ( ! width ) {
			return null;
		}
		const roundedWidth = Math.round( width );
		setContainerWidth( roundedWidth );
		return roundedWidth;
	}, [] );

	const setPreferred = useCallback( ( next: number ) => {
		const rounded = Math.round( next );
		preferredRef.current = rounded;
		setPreferredContentWidth( rounded );
	}, [] );

	const clearLegacyPreviewWidth = useCallback( () => {
		if ( ! hasLegacyPreviewWidthRef.current ) {
			return;
		}
		hasLegacyPreviewWidthRef.current = false;
		removeStoredResizablePanelWidth( PREVIEW_PANEL_STORAGE_KEY );
	}, [] );

	const persistContentWidth = useCallback(
		( next: number ) => {
			setPreferred( next );
			storeResizablePanelWidth( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, Math.round( next ) );
			clearLegacyPreviewWidth();
		},
		[ clearLegacyPreviewWidth, setPreferred ]
	);

	// First open: convert the legacy preview width into a content width against
	// the real container, then persist + drop the legacy key. This is also the
	// only place the migration runs, so the legacy key survives while closed.
	const ensurePreferred = useCallback(
		( container: number ) => {
			if ( preferredRef.current !== null ) {
				return preferredRef.current;
			}
			const next = getPreviewSplitLayout( container, container - legacyPreviewWidth ).contentWidth;
			setPreferred( next );
			if ( hasLegacyPreviewWidthRef.current ) {
				storeResizablePanelWidth( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, next );
				clearLegacyPreviewWidth();
			}
			return next;
		},
		[ clearLegacyPreviewWidth, legacyPreviewWidth, setPreferred ]
	);

	// Measure synchronously on open so the clamped px var is present before
	// paint (no flash of the calc() fallback).
	useLayoutEffect( () => {
		if ( ! showPreview ) {
			return;
		}
		const width = measureRootWidth();
		if ( width !== null ) {
			ensurePreferred( width );
		}
	}, [ ensurePreferred, measureRootWidth, showPreview ] );

	// Keep the measured container fresh so the displayed width and the handle's
	// aria values track window/sidebar resizes. CSS no longer absorbs resizes,
	// so this recompute is load-bearing. Falls back to a window resize listener
	// where ResizeObserver is unavailable (mirrors the theme-pattern widget).
	useEffect( () => {
		if ( ! showPreview ) {
			return;
		}
		const element = rootRef.current;
		if ( ! element ) {
			return;
		}
		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', measureRootWidth );
			return () => window.removeEventListener( 'resize', measureRootWidth );
		}
		const observer = new ResizeObserver( () => measureRootWidth() );
		observer.observe( element );
		return () => observer.disconnect();
	}, [ measureRootWidth, showPreview ] );

	const { isDragging, onMouseDown, cancel } = usePointerDrag( {
		onStart: () => {
			const container = measureRootWidth();
			if ( container === null ) {
				return null;
			}
			return getPreviewSplitLayout( container, ensurePreferred( container ) ).contentWidth;
		},
		onMove: ( start, deltaX ) => {
			const container = Math.round(
				rootRef.current?.getBoundingClientRect().width ?? containerWidth ?? 0
			);
			const layout = getPreviewSplitLayout( container, start + deltaX );
			setPreferred( layout.contentWidth );
			return layout.contentWidth;
		},
		onCommit: ( latest ) => persistContentWidth( latest ),
	} );

	// End an in-flight drag if the preview closes mid-resize.
	useEffect( () => {
		if ( ! showPreview ) {
			cancel();
		}
	}, [ cancel, showPreview ] );

	// Once a content width exists (already-stored on mount, or just set), the
	// legacy preview-width key is stale — drop it.
	useEffect( () => {
		if ( preferredContentWidth !== null ) {
			clearLegacyPreviewWidth();
		}
	}, [ clearLegacyPreviewWidth, preferredContentWidth ] );

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLElement > ) => {
			if (
				event.key !== 'ArrowLeft' &&
				event.key !== 'ArrowRight' &&
				event.key !== 'Home' &&
				event.key !== 'End'
			) {
				return;
			}
			const container = measureRootWidth();
			if ( container === null ) {
				return;
			}
			event.preventDefault();
			const step = event.shiftKey ? 40 : 16;
			const current = getPreviewSplitLayout( container, ensurePreferred( container ) );
			let nextContentWidth = current.contentWidth;
			if ( event.key === 'Home' ) {
				nextContentWidth = container - current.previewMinWidth;
			} else if ( event.key === 'End' ) {
				nextContentWidth = container - current.previewMaxWidth;
			} else {
				nextContentWidth += event.key === 'ArrowRight' ? step : -step;
			}
			persistContentWidth( getPreviewSplitLayout( container, nextContentWidth ).contentWidth );
		},
		[ ensurePreferred, measureRootWidth, persistContentWidth ]
	);

	// One clamp, two consumers: the rendered content width and the handle bounds.
	const layout = useMemo(
		() =>
			containerWidth === null
				? null
				: getPreviewSplitLayout(
						containerWidth,
						preferredContentWidth ?? containerWidth - legacyPreviewWidth
				  ),
		[ containerWidth, legacyPreviewWidth, preferredContentWidth ]
	);

	const contentWidthVar =
		layout === null || preferredContentWidth === null
			? `calc(100% - ${ legacyPreviewWidth }px)`
			: `${ layout.contentWidth }px`;

	return {
		rootRef,
		contentWidthVar,
		isResizing: isDragging,
		handleProps: {
			minWidth: layout?.previewMinWidth ?? PREVIEW_PANEL_MIN_WIDTH,
			maxWidth: layout?.previewMaxWidth ?? legacyPreviewWidth,
			width: layout?.previewWidth ?? legacyPreviewWidth,
			isResizing: isDragging,
			onResizeStart: onMouseDown,
			onKeyDown: handleKeyDown,
		},
	};
}
