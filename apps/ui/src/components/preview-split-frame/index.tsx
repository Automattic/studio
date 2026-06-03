import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
} from 'react';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import {
	getStoredResizablePanelWidth,
	getViewportWidth,
	PREVIEW_PANEL_CONFIG,
	PREVIEW_PANEL_STORAGE_KEY,
	storeResizablePanelWidth,
} from '@/lib/resizable-panels';
import styles from './style.module.css';

export interface PreviewSplitFramePreviewProps {
	collapsed: boolean;
	hideResizeHandle: boolean;
	layoutWidth: number;
}

interface PreviewSplitFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	preview?: ( props: PreviewSplitFramePreviewProps ) => ReactNode;
	previewOpen?: boolean;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
	contentMode?: 'framed' | 'raw';
	className?: string;
	contentColumnClassName?: string;
	scrollClassName?: string;
	composerOuterClassName?: string;
	composerContentClassName?: string;
}

const PREVIEW_TOGGLE_DURATION = 150;
const MIN_CONTENT_WIDTH = 280;

export function PreviewSplitFrame( {
	header,
	composer,
	preview,
	previewOpen = false,
	scrollRef,
	children,
	contentMode = 'framed',
	className,
	contentColumnClassName,
	scrollClassName,
	composerOuterClassName,
	composerContentClassName,
}: PreviewSplitFrameProps ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const [ contentWidth, setContentWidth ] = useState< number | null >( null );
	const [ rootWidth, setRootWidth ] = useState< number | null >( null );
	const [ previewWidth, setPreviewWidth ] = useState( () =>
		getStoredResizablePanelWidth(
			PREVIEW_PANEL_STORAGE_KEY,
			PREVIEW_PANEL_CONFIG,
			getViewportWidth()
		)
	);
	const [ previewAnimating, setPreviewAnimating ] = useState( false );
	const [ previewTransitioning, setPreviewTransitioning ] = useState( false );
	const [ previewResizing, setPreviewResizing ] = useState( false );
	const [ frozenPreviewLayoutWidth, setFrozenPreviewLayoutWidth ] = useState< number | null >(
		null
	);
	const previewCollapsed = ! previewOpen && ! previewAnimating;
	const previewLayoutWidth =
		frozenPreviewLayoutWidth ??
		( previewOpen && ! previewAnimating && contentWidth !== null && rootWidth !== null
			? Math.max( 0, rootWidth - contentWidth )
			: previewWidth );
	const contentLayoutWidth =
		contentWidth === null ? `calc(100% - ${ previewLayoutWidth }px)` : `${ contentWidth }px`;
	const rootWidthRef = useRef( rootWidth );
	const contentWidthRef = useRef( contentWidth );
	const previewOpenRef = useRef( previewOpen );
	const previewTransitioningRef = useRef( previewTransitioning );
	const previewWidthRef = useRef( previewWidth );
	const previewLayoutWidthRef = useRef( previewLayoutWidth );
	const previousPreviewOpenRef = useRef( previewOpen );
	const rootStyle = {
		'--preview-frame-content-width': contentLayoutWidth,
		'--preview-frame-preview-width': `${ previewLayoutWidth }px`,
	} as CSSProperties;

	useLayoutEffect( () => {
		rootWidthRef.current = rootWidth;
		contentWidthRef.current = contentWidth;
		previewOpenRef.current = previewOpen;
		previewTransitioningRef.current = previewTransitioning;
		previewWidthRef.current = previewWidth;
		previewLayoutWidthRef.current = previewLayoutWidth;
	}, [
		contentWidth,
		previewLayoutWidth,
		previewOpen,
		previewTransitioning,
		previewWidth,
		rootWidth,
	] );

	const applyLayoutStyles = useCallback( ( nextContentWidth: number, nextPreviewWidth: number ) => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}
		root.style.setProperty( '--preview-frame-content-width', `${ nextContentWidth }px` );
		root.style.setProperty( '--preview-frame-preview-width', `${ nextPreviewWidth }px` );
	}, [] );

	const measureRootWidth = useCallback( () => {
		const width = rootRef.current?.getBoundingClientRect().width;
		if ( ! width ) {
			return rootWidthRef.current;
		}
		const roundedWidth = Math.round( width );
		rootWidthRef.current = roundedWidth;
		setRootWidth( roundedWidth );
		return roundedWidth;
	}, [] );

	const clampContentWidth = useCallback( ( nextContentWidth: number, containerWidth: number ) => {
		const minContentWidth = Math.min( MIN_CONTENT_WIDTH, containerWidth );
		const maxContentWidth = Math.max(
			minContentWidth,
			containerWidth - PREVIEW_PANEL_CONFIG.minWidth
		);
		return Math.min( maxContentWidth, Math.max( minContentWidth, Math.round( nextContentWidth ) ) );
	}, [] );

	const getTargetContentWidth = useCallback(
		( containerWidth: number, targetPreviewWidth: number ) =>
			clampContentWidth( containerWidth - targetPreviewWidth, containerWidth ),
		[ clampContentWidth ]
	);

	const getTargetPreviewLayoutWidth = useCallback(
		( containerWidth: number, targetPreviewWidth: number ) => {
			return Math.max(
				0,
				Math.round( containerWidth - getTargetContentWidth( containerWidth, targetPreviewWidth ) )
			);
		},
		[ getTargetContentWidth ]
	);

	const applyContentWidth = useCallback(
		( nextContentWidth: number, containerWidth = rootWidthRef.current ) => {
			if ( containerWidth === null ) {
				return;
			}
			const clampedContentWidth = clampContentWidth( nextContentWidth, containerWidth );
			const nextPreviewWidth = Math.max( 0, Math.round( containerWidth - clampedContentWidth ) );
			contentWidthRef.current = clampedContentWidth;
			previewWidthRef.current = nextPreviewWidth;
			applyLayoutStyles( clampedContentWidth, nextPreviewWidth );
			setContentWidth( clampedContentWidth );
			setPreviewWidth( nextPreviewWidth );
			return nextPreviewWidth;
		},
		[ applyLayoutStyles, clampContentWidth ]
	);

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}
		const updateRootWidth = () => {
			const nextRootWidth = Math.round( root.getBoundingClientRect().width );
			if ( nextRootWidth <= 0 ) {
				return;
			}
			rootWidthRef.current = nextRootWidth;
			if ( previewOpenRef.current && ! previewTransitioningRef.current ) {
				const currentContentWidth = contentWidthRef.current;
				const shouldRestorePreviewWidth =
					currentContentWidth === null || currentContentWidth >= nextRootWidth;
				const nextContentWidth = shouldRestorePreviewWidth
					? getTargetContentWidth( nextRootWidth, previewWidthRef.current )
					: clampContentWidth( currentContentWidth, nextRootWidth );
				contentWidthRef.current = nextContentWidth;
				applyLayoutStyles( nextContentWidth, Math.max( 0, nextRootWidth - nextContentWidth ) );
				setContentWidth( nextContentWidth );
			} else if ( ! previewOpenRef.current && ! previewTransitioningRef.current ) {
				contentWidthRef.current = nextRootWidth;
				applyLayoutStyles( nextRootWidth, previewWidthRef.current );
				setContentWidth( nextRootWidth );
			}
			setRootWidth( nextRootWidth );
		};
		updateRootWidth();
		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateRootWidth );
			return () => window.removeEventListener( 'resize', updateRootWidth );
		}
		const resizeObserver = new ResizeObserver( updateRootWidth );
		resizeObserver.observe( root );
		return () => resizeObserver.disconnect();
	}, [ applyLayoutStyles, clampContentWidth, getTargetContentWidth ] );

	useLayoutEffect( () => {
		const wasPreviewOpen = previousPreviewOpenRef.current;
		previousPreviewOpenRef.current = previewOpen;
		if ( previewOpen === wasPreviewOpen ) {
			return;
		}

		let animationFrame: number | undefined;
		let transitionFrame: number | undefined;
		let targetFrame: number | undefined;
		let timeoutId: number | undefined;

		if ( ! previewOpen ) {
			setPreviewAnimating( true );
			setPreviewTransitioning( false );
			const currentRootWidth = measureRootWidth();
			if ( currentRootWidth !== null ) {
				setFrozenPreviewLayoutWidth( previewLayoutWidthRef.current );
				if ( contentWidthRef.current !== null ) {
					applyLayoutStyles( contentWidthRef.current, previewLayoutWidthRef.current );
				}
			}
			animationFrame = window.requestAnimationFrame( () => {
				setPreviewTransitioning( true );
				transitionFrame = window.requestAnimationFrame( () => {
					targetFrame = window.requestAnimationFrame( () => {
						const latestRootWidth = measureRootWidth();
						if ( latestRootWidth !== null ) {
							contentWidthRef.current = latestRootWidth;
							applyLayoutStyles( latestRootWidth, previewLayoutWidthRef.current );
							setContentWidth( latestRootWidth );
						}
						timeoutId = window.setTimeout( () => {
							setFrozenPreviewLayoutWidth( null );
							setPreviewAnimating( false );
							setPreviewTransitioning( false );
						}, PREVIEW_TOGGLE_DURATION );
					} );
				} );
			} );
			return () => {
				if ( animationFrame ) window.cancelAnimationFrame( animationFrame );
				if ( transitionFrame ) window.cancelAnimationFrame( transitionFrame );
				if ( targetFrame ) window.cancelAnimationFrame( targetFrame );
				if ( timeoutId ) window.clearTimeout( timeoutId );
			};
		}

		setPreviewAnimating( true );
		setPreviewTransitioning( false );
		const currentRootWidth = measureRootWidth();
		if ( currentRootWidth !== null ) {
			const targetPreviewWidth = getTargetPreviewLayoutWidth(
				currentRootWidth,
				previewWidthRef.current
			);
			setFrozenPreviewLayoutWidth( targetPreviewWidth );
			contentWidthRef.current = currentRootWidth;
			applyLayoutStyles( currentRootWidth, targetPreviewWidth );
			setContentWidth( currentRootWidth );
		} else {
			setFrozenPreviewLayoutWidth( previewWidthRef.current );
		}

		animationFrame = window.requestAnimationFrame( () => {
			setPreviewTransitioning( true );
			transitionFrame = window.requestAnimationFrame( () => {
				targetFrame = window.requestAnimationFrame( () => {
					const latestRootWidth = measureRootWidth();
					if ( latestRootWidth !== null ) {
						const targetContentWidth = getTargetContentWidth(
							latestRootWidth,
							previewWidthRef.current
						);
						contentWidthRef.current = targetContentWidth;
						applyLayoutStyles( targetContentWidth, latestRootWidth - targetContentWidth );
						setContentWidth( targetContentWidth );
					}
					timeoutId = window.setTimeout( () => {
						setFrozenPreviewLayoutWidth( null );
						setPreviewAnimating( false );
						setPreviewTransitioning( false );
					}, PREVIEW_TOGGLE_DURATION );
				} );
			} );
		} );
		return () => {
			if ( animationFrame ) window.cancelAnimationFrame( animationFrame );
			if ( transitionFrame ) window.cancelAnimationFrame( transitionFrame );
			if ( targetFrame ) window.cancelAnimationFrame( targetFrame );
			if ( timeoutId ) window.clearTimeout( timeoutId );
		};
	}, [
		applyLayoutStyles,
		getTargetContentWidth,
		getTargetPreviewLayoutWidth,
		measureRootWidth,
		previewOpen,
	] );

	useLayoutEffect( () => {
		if ( ! previewOpen || previewAnimating || rootWidth === null || contentWidth !== null ) {
			return;
		}
		const targetContentWidth = getTargetContentWidth( rootWidth, previewWidth );
		contentWidthRef.current = targetContentWidth;
		setContentWidth( targetContentWidth );
	}, [
		contentWidth,
		getTargetContentWidth,
		previewAnimating,
		previewOpen,
		previewWidth,
		rootWidth,
	] );

	const handlePreviewResizeStart = useCallback(
		( event: MouseEvent< HTMLDivElement > ) => {
			if ( event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			const containerWidth = measureRootWidth();
			if ( containerWidth === null ) {
				return;
			}

			const startX = event.clientX;
			const startContentWidth =
				contentWidthRef.current ??
				getTargetContentWidth( containerWidth, previewLayoutWidthRef.current );
			let frame: number | undefined;
			let latestPreviewWidth = Math.max( 0, containerWidth - startContentWidth );
			const originalCursor = document.body.style.cursor;
			const originalUserSelect = document.body.style.userSelect;
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			setPreviewResizing( true );

			const cleanup = () => {
				if ( frame ) {
					window.cancelAnimationFrame( frame );
				}
				document.body.style.cursor = originalCursor;
				document.body.style.userSelect = originalUserSelect;
				document.removeEventListener( 'mousemove', handleMouseMove );
				document.removeEventListener( 'mouseup', handleMouseUp );
			};

			const updateFromClientX = ( clientX: number ) => {
				const activeContainerWidth = rootWidthRef.current ?? containerWidth;
				const nextContentWidth = startContentWidth + clientX - startX;
				const appliedPreviewWidth = applyContentWidth( nextContentWidth, activeContainerWidth );
				if ( appliedPreviewWidth !== undefined ) {
					latestPreviewWidth = appliedPreviewWidth;
				}
			};

			const handleMouseMove = ( mouseMoveEvent: globalThis.MouseEvent ) => {
				if ( frame ) {
					window.cancelAnimationFrame( frame );
				}
				frame = window.requestAnimationFrame( () => updateFromClientX( mouseMoveEvent.clientX ) );
			};

			const handleMouseUp = ( mouseUpEvent: globalThis.MouseEvent ) => {
				updateFromClientX( mouseUpEvent.clientX );
				storeResizablePanelWidth( PREVIEW_PANEL_STORAGE_KEY, latestPreviewWidth );
				setPreviewResizing( false );
				cleanup();
			};

			document.addEventListener( 'mousemove', handleMouseMove );
			document.addEventListener( 'mouseup', handleMouseUp );
		},
		[ applyContentWidth, getTargetContentWidth, measureRootWidth ]
	);

	const handlePreviewResizeKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			if (
				event.key !== 'ArrowLeft' &&
				event.key !== 'ArrowRight' &&
				event.key !== 'Home' &&
				event.key !== 'End'
			) {
				return;
			}
			const containerWidth = measureRootWidth();
			if ( containerWidth === null ) {
				return;
			}

			event.preventDefault();
			const step = event.shiftKey ? 40 : 16;
			const currentContentWidth =
				contentWidthRef.current ??
				getTargetContentWidth( containerWidth, previewLayoutWidthRef.current );
			let nextContentWidth = currentContentWidth;
			if ( event.key === 'Home' ) {
				nextContentWidth = containerWidth - PREVIEW_PANEL_CONFIG.minWidth;
			} else if ( event.key === 'End' ) {
				nextContentWidth = MIN_CONTENT_WIDTH;
			} else {
				nextContentWidth += event.key === 'ArrowRight' ? step : -step;
			}

			const nextPreviewWidth = applyContentWidth( nextContentWidth, containerWidth );
			if ( nextPreviewWidth !== undefined ) {
				storeResizablePanelWidth( PREVIEW_PANEL_STORAGE_KEY, nextPreviewWidth );
			}
		},
		[ applyContentWidth, getTargetContentWidth, measureRootWidth ]
	);

	const renderedPreview = preview?.( {
		collapsed: previewCollapsed,
		hideResizeHandle: true,
		layoutWidth: previewLayoutWidth,
	} );
	const previewMaxWidth = Math.max(
		PREVIEW_PANEL_CONFIG.minWidth,
		( rootWidth ?? previewLayoutWidth ) - MIN_CONTENT_WIDTH
	);

	return (
		<div
			ref={ rootRef }
			className={ clsx(
				styles.root,
				className,
				previewOpen && styles.rootPreviewOpen,
				contentWidth !== null && styles.rootPreviewMeasured,
				previewTransitioning && styles.rootPreviewAnimating,
				previewResizing && styles.rootPreviewResizing
			) }
			style={ rootStyle }
		>
			<div
				className={ clsx(
					styles.contentColumn,
					contentMode === 'raw' && styles.contentColumnRaw,
					contentColumnClassName
				) }
			>
				{ contentMode === 'raw' ? (
					children
				) : (
					<PreviewSplitContent
						header={ header }
						composer={ composer }
						scrollRef={ scrollRef }
						scrollClassName={ scrollClassName }
						composerOuterClassName={ composerOuterClassName }
						composerContentClassName={ composerContentClassName }
					>
						{ children }
					</PreviewSplitContent>
				) }
			</div>
			<div
				className={ clsx(
					styles.previewSlot,
					previewOpen &&
						contentWidth !== null &&
						! previewAnimating &&
						styles.previewSlotInteractive
				) }
			>
				{ renderedPreview }
			</div>
			{ previewOpen && contentWidth !== null && ! previewAnimating ? (
				<ResizeHandle
					className={ styles.previewResizeHandle }
					label={ __( 'Resize site preview' ) }
					minWidth={ PREVIEW_PANEL_CONFIG.minWidth }
					maxWidth={ previewMaxWidth }
					width={ previewLayoutWidth }
					isResizing={ previewResizing }
					onResizeStart={ handlePreviewResizeStart }
					onKeyDown={ handlePreviewResizeKeyDown }
				/>
			) : null }
			{ previewResizing ? <ResizeOverlay /> : null }
		</div>
	);
}

interface PreviewSplitContentProps {
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
	scrollClassName?: string;
	composerOuterClassName?: string;
	composerContentClassName?: string;
}

export function PreviewSplitContent( {
	header,
	composer,
	scrollRef,
	children,
	scrollClassName,
	composerOuterClassName,
	composerContentClassName,
}: PreviewSplitContentProps ) {
	return (
		<div ref={ scrollRef } className={ clsx( styles.scroll, scrollClassName ) }>
			{ header }
			{ children }
			{ composer !== undefined ? (
				<div className={ clsx( styles.composerOuter, composerOuterClassName ) }>
					<ProgressiveBlur direction="bottom" variant="extended" />
					<div className={ clsx( styles.composerContent, composerContentClassName ) }>
						{ composer }
					</div>
				</div>
			) : null }
		</div>
	);
}
