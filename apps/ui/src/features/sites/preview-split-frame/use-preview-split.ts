import { isRTL } from '@wordpress/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
	getInitialPreviewContentWidth,
	getPreviewSplitLayout,
	PANEL_WIDTHS_RESET_EVENT,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	PREVIEW_CONTENT_DEFAULT_WIDTH,
	PREVIEW_PANEL_MIN_WIDTH,
	storeResizablePanelWidth,
} from '@/data/resizable-panels';
import { usePointerDrag } from '@/lib/hooks';
import type { KeyboardEvent, MouseEventHandler, RefObject } from 'react';

interface UsePreviewSplitOptions {
	siteId?: string;
	showPreview: boolean;
}

interface PreviewSplitHandleProps {
	minWidth: number;
	maxWidth: number;
	width: number;
	onResizeStart: MouseEventHandler< HTMLElement >;
	onKeyDown: ( event: KeyboardEvent< HTMLElement > ) => void;
}

interface UsePreviewSplitResult {
	rootRef: RefObject< HTMLDivElement | null >;
	containerWidth: number | null;
	// The value for the --preview-frame-content-width CSS var: the clamped px
	// width once measured, or the default content width before that.
	contentWidthVar: string;
	isResizing: boolean;
	handleProps: PreviewSplitHandleProps;
}

// Owns the preview/content split: a single clamp (getPreviewSplitLayout) feeds
// both the rendered content width and the resize handle's reported bounds, so
// CSS never re-clamps. Keeps two state atoms — the user's preferred content
// width (persisted) and the measured container width — and derives everything
// else.
export function usePreviewSplit( {
	showPreview,
	siteId,
}: UsePreviewSplitOptions ): UsePreviewSplitResult {
	const rootRef = useRef< HTMLDivElement >( null );

	// `preferredContentWidth` is the user's intent (persisted); the displayed
	// width is always re-derived from it against the current container, never
	// stored back. Recomputing from a previously-clamped displayed value would
	// lose the intent on shrink-then-grow.
	const [ preferredContentWidth, setPreferredContentWidth ] = useState< number | null >( () =>
		getInitialPreviewContentWidth()
	);
	const [ containerWidth, setContainerWidth ] = useState< number | null >( null );
	// Mirrors preferredContentWidth so event handlers read the latest value
	// without re-subscribing. setPreferred is the only writer of the state, and
	// it updates this ref in lockstep, so the two never drift.
	const preferredRef = useRef( preferredContentWidth );

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

	const persistContentWidth = useCallback(
		( next: number ) => {
			setPreferred( next );
			storeResizablePanelWidth( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, Math.round( next ) );
		},
		[ setPreferred ]
	);

	const ensurePreferred = useCallback( () => {
		if ( preferredRef.current === null ) {
			setPreferred( PREVIEW_CONTENT_DEFAULT_WIDTH );
		}
		return preferredRef.current ?? PREVIEW_CONTENT_DEFAULT_WIDTH;
	}, [ setPreferred ] );

	// Measure synchronously on open so the clamped px var is present before
	// paint (no flash of the calc() fallback).
	useLayoutEffect( () => {
		if ( ! showPreview ) {
			return;
		}
		if ( measureRootWidth() !== null ) {
			ensurePreferred();
		}
	}, [ ensurePreferred, measureRootWidth, showPreview ] );

	useEffect( () => {
		const reset = () => {
			preferredRef.current = null;
			setPreferredContentWidth( null );
			if ( measureRootWidth() !== null ) {
				ensurePreferred();
			}
		};
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
	}, [ ensurePreferred, measureRootWidth ] );

	// Keep the measured container fresh so the displayed width and the handle's
	// aria values track window/sidebar resizes. CSS no longer absorbs resizes,
	// so this recompute is load-bearing. Falls back to a window resize listener
	// where ResizeObserver is unavailable.
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
			return getPreviewSplitLayout( container, ensurePreferred() ).contentWidth;
		},
		onMove: ( start, deltaX ) => {
			const container = Math.round(
				rootRef.current?.getBoundingClientRect().width ?? containerWidth ?? 0
			);
			// The content column is anchored to the inline-start edge, so in RTL a
			// rightward drag shrinks it instead of growing it.
			const layout = getPreviewSplitLayout( container, start + ( isRTL() ? -deltaX : deltaX ) );
			setPreferred( layout.contentWidth );
			return layout.contentWidth;
		},
		onCommit: ( latest ) => persistContentWidth( latest ),
	} );

	useLayoutEffect( () => {
		cancel();
	}, [ cancel, siteId ] );

	// End an in-flight drag if the preview closes mid-resize.
	useEffect( () => {
		if ( ! showPreview ) {
			cancel();
		}
	}, [ cancel, showPreview ] );

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
			const current = getPreviewSplitLayout( container, ensurePreferred() );
			let nextContentWidth = current.contentWidth;
			if ( event.key === 'Home' ) {
				nextContentWidth = container - current.previewMinWidth;
			} else if ( event.key === 'End' ) {
				nextContentWidth = container - current.previewMaxWidth;
			} else {
				const grow = event.key === 'ArrowRight' ? step : -step;
				nextContentWidth += isRTL() ? -grow : grow;
			}
			persistContentWidth( getPreviewSplitLayout( container, nextContentWidth ).contentWidth );
		},
		[ ensurePreferred, measureRootWidth, persistContentWidth ]
	);

	const layout = useMemo(
		() =>
			containerWidth === null
				? null
				: getPreviewSplitLayout(
						containerWidth,
						preferredContentWidth ?? PREVIEW_CONTENT_DEFAULT_WIDTH
				  ),
		[ containerWidth, preferredContentWidth ]
	);

	const contentWidthVar =
		layout === null ? `${ PREVIEW_CONTENT_DEFAULT_WIDTH }px` : `${ layout.contentWidth }px`;

	return {
		rootRef,
		containerWidth,
		contentWidthVar,
		isResizing: isDragging,
		handleProps: {
			minWidth: layout?.previewMinWidth ?? PREVIEW_PANEL_MIN_WIDTH,
			maxWidth: layout?.previewMaxWidth ?? PREVIEW_PANEL_MIN_WIDTH,
			width: layout?.previewWidth ?? PREVIEW_PANEL_MIN_WIDTH,
			onResizeStart: onMouseDown,
			onKeyDown: handleKeyDown,
		},
	};
}
