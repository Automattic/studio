import { isRTL } from '@wordpress/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import {
	getInitialPreviewContentWidth,
	getPreviewSplitLayout,
	PREVIEW_CONTENT_DEFAULT_WIDTH,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	PREVIEW_PANEL_DEFAULT_WIDTH,
	PREVIEW_PANEL_MIN_WIDTH,
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
	// The value for the --preview-frame-content-width CSS var: the clamped px
	// width once measured, or the default content width before the first
	// measurement.
	contentWidthVar: string;
	isResizing: boolean;
	handleProps: PreviewSplitHandleProps;
}

// Owns the preview/content split: a single clamp (getPreviewSplitLayout) feeds
// both the rendered content width and the resize handle's reported bounds, so
// CSS never re-clamps. Keeps two state atoms — the user's preferred content
// width (persisted) and the measured container width — and derives everything
// else.
export function usePreviewSplit( { showPreview }: UsePreviewSplitOptions ): UsePreviewSplitResult {
	const rootRef = useRef< HTMLDivElement >( null );

	// `preferredContentWidth` is the user's explicit intent (persisted); the
	// displayed width is always re-derived from it against the current
	// container, never stored back. Recomputing from a previously-clamped
	// displayed value would lose the intent on shrink-then-grow. While null (the
	// user never resized the split), the content column anchors to
	// PREVIEW_CONTENT_DEFAULT_WIDTH against the live container — a narrow window
	// clamps it down but growth restores it (never freezing a squeezed
	// measurement), and the preview absorbs the rest.
	const [ preferredContentWidth, setPreferredContentWidth ] = useState< number | null >(
		getInitialPreviewContentWidth
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

	// The content width a resize gesture starts from: the user's explicit
	// intent when set, otherwise the clamped default. Pure — deriving must not
	// become intent, or the split would stop recovering from a squeezed layout
	// when the window later grows.
	const resolveContentWidth = useCallback(
		( container: number ) =>
			preferredRef.current ??
			getPreviewSplitLayout( container, PREVIEW_CONTENT_DEFAULT_WIDTH ).contentWidth,
		[]
	);

	// Measure synchronously on open so the clamped px var is present before
	// paint (no flash of the calc() fallback).
	useLayoutEffect( () => {
		if ( ! showPreview ) {
			return;
		}
		measureRootWidth();
	}, [ measureRootWidth, showPreview ] );

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
			return getPreviewSplitLayout( container, resolveContentWidth( container ) ).contentWidth;
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
			const current = getPreviewSplitLayout( container, resolveContentWidth( container ) );
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
		[ resolveContentWidth, measureRootWidth, persistContentWidth ]
	);

	// One clamp, two consumers: the rendered content width and the handle bounds.
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
		contentWidthVar,
		isResizing: isDragging,
		handleProps: {
			minWidth: layout?.previewMinWidth ?? PREVIEW_PANEL_MIN_WIDTH,
			maxWidth: layout?.previewMaxWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
			width: layout?.previewWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
			isResizing: isDragging,
			onResizeStart: onMouseDown,
			onKeyDown: handleKeyDown,
		},
	};
}
