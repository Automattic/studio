import { __, sprintf } from '@wordpress/i18n';
import {
	chevronLeft,
	chevronRight,
	closeSmall,
	download as downloadIcon,
	gallery,
	lineSolid,
	plus,
} from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageContextMenu, getImageFilename } from '@/components/image-context-menu';
import * as Menu from '@/components/menu';
import styles from './style.module.css';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface LightboxImage {
	src: string;
	alt: string;
}

// Breathing room around a fitted image.
const STAGE_PADDING = 48;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.5;
// Wheel deltaY → zoom factor exponent; tuned for trackpads and mouse wheels.
const WHEEL_SENSITIVITY = 0.0022;
const DRAG_MOVE_THRESHOLD_PX = 3;

interface Size {
	width: number;
	height: number;
}

interface Point {
	x: number;
	y: number;
}

function clamp( value: number, min: number, max: number ): number {
	return Math.min( max, Math.max( min, value ) );
}

function computeFitScale( natural: Size, viewport: Size ): number {
	return Math.min(
		( viewport.width - STAGE_PADDING * 2 ) / natural.width,
		( viewport.height - STAGE_PADDING * 2 ) / natural.height,
		1
	);
}

function useViewportSize(): Size {
	const [ size, setSize ] = useState< Size >( () => ( {
		width: window.innerWidth,
		height: window.innerHeight,
	} ) );
	useEffect( () => {
		const onResize = () => setSize( { width: window.innerWidth, height: window.innerHeight } );
		window.addEventListener( 'resize', onResize );
		return () => window.removeEventListener( 'resize', onResize );
	}, [] );
	return size;
}

function getDownloadFilename( image: LightboxImage, index: number ): string {
	return getImageFilename( image, `image-${ index + 1 }.png` );
}

// Backdrop areas that dismiss the lightbox when clicked (the stage itself
// and each slide's empty space around its image).
function isDismissTarget( target: EventTarget | null ): boolean {
	return target instanceof HTMLElement && target.dataset.lightboxDismiss !== undefined;
}

/**
 * Full-window image viewer for conversation images. Feature set modeled on
 * the common lightbox vocabulary (PhotoSwipe, chat-app viewers):
 *
 * - All images sit on one horizontal carousel track; prev/next (arrows,
 *   ←/→ keys) slide between them with a position counter in the toolbar.
 * - A grid view (toolbar toggle) lays out every image in the conversation;
 *   clicking a tile jumps the carousel there.
 * - Fit-to-window by default; never larger than natural size at "fit".
 * - Zoom on the current image: scroll wheel (anchored to the cursor),
 *   double-click toggle, toolbar − / + buttons, and a % readout that
 *   toggles fit ↔ actual size.
 * - Drag to pan while zoomed in (from the image or the backdrop).
 * - Keyboard: Escape closes, + / − zoom, 0 resets to fit.
 * - Download button; click on the backdrop closes.
 */
export function ImageLightbox( {
	images,
	initialIndex = 0,
	onClose,
}: {
	images: LightboxImage[];
	initialIndex?: number;
	onClose: () => void;
} ) {
	const [ index, setIndex ] = useState( () => clamp( initialIndex, 0, images.length - 1 ) );
	const image = images[ index ];
	const viewport = useViewportSize();
	// Natural sizes arrive per slide as each image loads.
	const [ naturals, setNaturals ] = useState< Array< Size | null > >( () =>
		images.map( () => null )
	);
	const natural = naturals[ index ] ?? null;
	// null means "fit to window" — recomputed as the window resizes.
	const [ zoom, setZoom ] = useState< number | null >( null );
	// Active image's center offset from its slide center, in screen pixels.
	const [ offset, setOffset ] = useState< Point >( { x: 0, y: 0 } );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ isWheeling, setIsWheeling ] = useState( false );
	// Grid overview of every image; replaces the carousel until a tile is
	// picked (or Escape returns to the carousel).
	const [ isGridOpen, setIsGridOpen ] = useState( false );
	const isGridOpenRef = useRef( isGridOpen );
	const activeTileRef = useRef< HTMLButtonElement | null >( null );
	useEffect( () => {
		isGridOpenRef.current = isGridOpen;
	} );
	useEffect( () => {
		if ( isGridOpen ) {
			activeTileRef.current?.scrollIntoView( { block: 'center' } );
		}
	}, [ isGridOpen ] );

	// The track must not animate while the window is resizing (each pixel of
	// resize would rubber-band through the 300ms slide easing). This also
	// covers mount, so opening never plays a slide-in.
	const [ isResizing, setIsResizing ] = useState( true );
	useEffect( () => {
		setIsResizing( true );
		const timeout = window.setTimeout( () => setIsResizing( false ), 200 );
		return () => window.clearTimeout( timeout );
	}, [ viewport ] );

	// Zoom transitions stay off until a frame after the active image is
	// measured — otherwise its first styled frame animates from the
	// unloaded state and the image appears to slide in from a corner.
	const [ transitionsReady, setTransitionsReady ] = useState( false );
	useEffect( () => {
		if ( ! natural ) {
			setTransitionsReady( false );
			return;
		}
		const frame = requestAnimationFrame( () => setTransitionsReady( true ) );
		return () => cancelAnimationFrame( frame );
	}, [ natural ] );

	const stageRef = useRef< HTMLDivElement | null >( null );
	const closeButtonRef = useRef< HTMLButtonElement | null >( null );
	const wheelTimeoutRef = useRef< number | null >( null );
	const dragRef = useRef< {
		pointerId: number;
		start: Point;
		startOffset: Point;
	} | null >( null );
	// Pointer captures retarget the follow-up click to the stage, which
	// would read as a backdrop click; this flags those clicks to ignore.
	const suppressCloseClickRef = useRef( false );

	// While an image's right-click menu is open, the lightbox's global
	// keyboard shortcuts stand down: Base UI owns Escape (close the menu, not
	// the lightbox) and the arrow keys (menu item navigation, not slides).
	const isMenuOpenRef = useRef( false );
	const handleMenuOpenChange = useCallback( ( open: boolean ) => {
		isMenuOpenRef.current = open;
	}, [] );

	// Left-clicking outside an open menu should only dismiss the menu, but
	// Base UI's dismissal still lets the press's click land on the stage,
	// where it would read as a backdrop close. This capture listener runs
	// before Base UI closes the menu — while the ref is still true — and
	// flags that click to be swallowed.
	useEffect( () => {
		const onPointerDown = ( event: PointerEvent ) => {
			if (
				event.button === 0 &&
				isMenuOpenRef.current &&
				event.target instanceof Node &&
				stageRef.current?.contains( event.target )
			) {
				suppressCloseClickRef.current = true;
			}
		};
		window.addEventListener( 'pointerdown', onPointerDown, true );
		return () => window.removeEventListener( 'pointerdown', onPointerDown, true );
	}, [] );

	const fitScale = natural ? computeFitScale( natural, viewport ) : null;
	const scale = zoom ?? fitScale;
	const canPan = Boolean(
		natural &&
			scale !== null &&
			( natural.width * scale > viewport.width || natural.height * scale > viewport.height )
	);

	const setNaturalAt = useCallback( ( slideIndex: number, size: Size ) => {
		setNaturals( ( current ) => {
			if ( current[ slideIndex ] ) {
				return current;
			}
			return current.map( ( value, i ) => ( i === slideIndex ? size : value ) );
		} );
	}, [] );

	const clampOffsetFor = useCallback(
		( next: Point, atScale: number ): Point => {
			if ( ! natural ) {
				return { x: 0, y: 0 };
			}
			// Pan bounds run to the viewport edge (not the padded fit box) so
			// every part of a zoomed image stays reachable.
			const maxX = Math.max( 0, ( natural.width * atScale - viewport.width ) / 2 );
			const maxY = Math.max( 0, ( natural.height * atScale - viewport.height ) / 2 );
			return { x: clamp( next.x, -maxX, maxX ), y: clamp( next.y, -maxY, maxY ) };
		},
		[ natural, viewport ]
	);

	const resetToFit = useCallback( () => {
		setZoom( null );
		setOffset( { x: 0, y: 0 } );
	}, [] );

	// Zoom to an absolute scale, keeping the point under `focal` (viewport
	// coordinates) stationary. Without a focal point, zooms around center.
	const zoomTo = useCallback(
		( targetScale: number, focal?: Point ) => {
			if ( fitScale === null || scale === null ) {
				return;
			}
			const next = clamp( targetScale, fitScale, MAX_SCALE );
			if ( next <= fitScale + 0.0001 ) {
				resetToFit();
				return;
			}
			const focalX = focal ? focal.x - viewport.width / 2 : 0;
			const focalY = focal ? focal.y - viewport.height / 2 : 0;
			const ratio = next / scale;
			setZoom( next );
			setOffset(
				clampOffsetFor(
					{
						x: focalX - ( focalX - offset.x ) * ratio,
						y: focalY - ( focalY - offset.y ) * ratio,
					},
					next
				)
			);
		},
		[ fitScale, scale, offset, viewport, clampOffsetFor, resetToFit ]
	);

	const navigate = useCallback(
		( delta: number ) => {
			if ( images.length < 2 ) {
				return;
			}
			setIndex( ( current ) => ( current + delta + images.length ) % images.length );
			setZoom( null );
			setOffset( { x: 0, y: 0 } );
		},
		[ images.length ]
	);

	// Keep the pan clamped when the window shrinks around a zoomed image.
	useEffect( () => {
		if ( scale === null ) {
			return;
		}
		setOffset( ( current ) => clampOffsetFor( current, scale ) );
	}, [ clampOffsetFor, scale ] );

	// Wheel zoom needs a non-passive listener (React's synthetic wheel events
	// are passive, so preventDefault would be ignored).
	const zoomToRef = useRef( zoomTo );
	const scaleRef = useRef( scale );
	useEffect( () => {
		zoomToRef.current = zoomTo;
		scaleRef.current = scale;
	} );
	useEffect( () => {
		const stage = stageRef.current;
		if ( ! stage ) {
			return;
		}
		const onWheel = ( event: WheelEvent ) => {
			// The grid scrolls natively — don't hijack its wheel for zoom.
			if ( isGridOpenRef.current ) {
				return;
			}
			event.preventDefault();
			const currentScale = scaleRef.current;
			if ( currentScale === null ) {
				return;
			}
			setIsWheeling( true );
			if ( wheelTimeoutRef.current !== null ) {
				window.clearTimeout( wheelTimeoutRef.current );
			}
			wheelTimeoutRef.current = window.setTimeout( () => setIsWheeling( false ), 160 );
			zoomToRef.current( currentScale * Math.exp( -event.deltaY * WHEEL_SENSITIVITY ), {
				x: event.clientX,
				y: event.clientY,
			} );
		};
		stage.addEventListener( 'wheel', onWheel, { passive: false } );
		return () => {
			stage.removeEventListener( 'wheel', onWheel );
			if ( wheelTimeoutRef.current !== null ) {
				window.clearTimeout( wheelTimeoutRef.current );
			}
		};
	}, [] );

	// Focus management + keyboard controls.
	useEffect( () => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeButtonRef.current?.focus();
		return () => previouslyFocused?.focus();
	}, [] );
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( isMenuOpenRef.current ) {
				return;
			}
			switch ( event.key ) {
				case 'Escape':
					event.stopPropagation();
					// Escape peels one layer: grid back to carousel, then close.
					if ( isGridOpen ) {
						setIsGridOpen( false );
					} else {
						onClose();
					}
					break;
				case 'ArrowLeft':
					navigate( -1 );
					break;
				case 'ArrowRight':
					navigate( 1 );
					break;
				case '+':
				case '=':
					if ( ! isGridOpen && scale !== null ) {
						zoomTo( scale * ZOOM_STEP );
					}
					break;
				case '-':
				case '_':
					if ( ! isGridOpen && scale !== null ) {
						zoomTo( scale / ZOOM_STEP );
					}
					break;
				case '0':
					if ( ! isGridOpen ) {
						resetToFit();
					}
					break;
			}
		};
		window.addEventListener( 'keydown', onKeyDown, true );
		return () => window.removeEventListener( 'keydown', onKeyDown, true );
	}, [ onClose, navigate, zoomTo, resetToFit, scale, isGridOpen ] );

	const handlePointerDown = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		// A flagged press is the one dismissing an open context menu — it
		// shouldn't also start a pan.
		if ( isGridOpen || event.button !== 0 || ! canPan || suppressCloseClickRef.current ) {
			return;
		}
		if ( event.target instanceof Element && event.target.closest( 'button, a' ) ) {
			return;
		}
		event.preventDefault();
		stageRef.current?.setPointerCapture( event.pointerId );
		dragRef.current = {
			pointerId: event.pointerId,
			start: { x: event.clientX, y: event.clientY },
			startOffset: offset,
		};
		// Capture retargets the click to the stage even when the press began
		// on the image — don't let that read as a backdrop close.
		suppressCloseClickRef.current = ! isDismissTarget( event.target );
		setIsDragging( true );
	};

	const handlePointerMove = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		const drag = dragRef.current;
		if ( ! drag || drag.pointerId !== event.pointerId || scale === null ) {
			return;
		}
		const dx = event.clientX - drag.start.x;
		const dy = event.clientY - drag.start.y;
		if ( Math.abs( dx ) + Math.abs( dy ) > DRAG_MOVE_THRESHOLD_PX ) {
			suppressCloseClickRef.current = true;
		}
		setOffset(
			clampOffsetFor( { x: drag.startOffset.x + dx, y: drag.startOffset.y + dy }, scale )
		);
	};

	const handlePointerEnd = ( event: ReactPointerEvent< HTMLDivElement > ) => {
		if ( dragRef.current?.pointerId === event.pointerId ) {
			dragRef.current = null;
			setIsDragging( false );
		}
	};

	const handleStageClick = ( event: ReactMouseEvent< HTMLDivElement > ) => {
		if ( suppressCloseClickRef.current ) {
			suppressCloseClickRef.current = false;
			return;
		}
		if ( isDismissTarget( event.target ) ) {
			onClose();
		}
	};

	const handleImageDoubleClick = ( event: ReactMouseEvent< HTMLImageElement > ) => {
		if ( fitScale === null ) {
			return;
		}
		if ( zoom !== null ) {
			resetToFit();
		} else {
			zoomTo( Math.max( 1, fitScale * 2 ), { x: event.clientX, y: event.clientY } );
		}
	};

	const imageCursor = ( () => {
		if ( isDragging ) {
			return styles.imageGrabbing;
		}
		return canPan ? styles.imageGrab : undefined;
	} )();

	return createPortal(
		<div
			ref={ stageRef }
			className={ styles.stage }
			role="dialog"
			aria-modal="true"
			aria-label={ image.alt }
			data-lightbox-dismiss
			onClick={ handleStageClick }
			onPointerDown={ handlePointerDown }
			onPointerMove={ handlePointerMove }
			onPointerUp={ handlePointerEnd }
			onPointerCancel={ handlePointerEnd }
		>
			{ isGridOpen ? (
				<div className={ styles.gridView }>
					<div className={ styles.gridViewInner }>
						{ images.map( ( gridImage, gridIndex ) => (
							<ImageContextMenu
								key={ `${ gridImage.src }:${ gridIndex }` }
								image={ gridImage }
								downloadFilename={ getDownloadFilename( gridImage, gridIndex ) }
								onOpenChange={ handleMenuOpenChange }
								trigger={
									<Button
										ref={ gridIndex === index ? activeTileRef : undefined }
										variant="unstyled"
										className={ clsx(
											styles.gridTile,
											gridIndex === index && styles.gridTileActive
										) }
										aria-label={ gridImage.alt }
										aria-current={ gridIndex === index ? 'true' : undefined }
										onClick={ () => {
											setIndex( gridIndex );
											resetToFit();
											setIsGridOpen( false );
										} }
									>
										<img
											className={ styles.gridTileImage }
											src={ gridImage.src }
											alt=""
											draggable={ false }
										/>
									</Button>
								}
							/>
						) ) }
					</div>
				</div>
			) : (
				<div
					className={ clsx( styles.track, isResizing && styles.trackInstant ) }
					style={ { transform: `translateX(${ -index * viewport.width }px)` } }
				>
					{ images.map( ( slideImage, slideIndex ) => {
						const slideNatural = naturals[ slideIndex ] ?? null;
						const isActive = slideIndex === index;
						const slideScale = isActive
							? scale
							: slideNatural && computeFitScale( slideNatural, viewport );
						const slideOffset = isActive ? offset : { x: 0, y: 0 };
						return (
							<div
								key={ `${ slideImage.src }:${ slideIndex }` }
								className={ styles.slide }
								style={ { width: viewport.width } }
								data-lightbox-dismiss
								aria-hidden={ isActive ? undefined : 'true' }
							>
								<ImageContextMenu
									image={ slideImage }
									downloadFilename={ getDownloadFilename( slideImage, slideIndex ) }
									onOpenChange={ handleMenuOpenChange }
									trigger={
										<img
											ref={ ( node ) => {
												if ( node && node.complete && node.naturalWidth > 0 ) {
													setNaturalAt( slideIndex, {
														width: node.naturalWidth,
														height: node.naturalHeight,
													} );
												}
											} }
											className={ clsx(
												styles.image,
												( ! isActive || ! transitionsReady || isDragging || isWheeling ) &&
													styles.imageInstant,
												isActive && imageCursor
											) }
											src={ slideImage.src }
											alt={ slideImage.alt }
											draggable={ false }
											onLoad={ ( event ) =>
												setNaturalAt( slideIndex, {
													width: event.currentTarget.naturalWidth,
													height: event.currentTarget.naturalHeight,
												} )
											}
											onDoubleClick={ isActive ? handleImageDoubleClick : undefined }
											style={
												slideNatural && slideScale
													? {
															width: slideNatural.width,
															height: slideNatural.height,
															transform: `translate(calc(-50% + ${ slideOffset.x }px), calc(-50% + ${ slideOffset.y }px)) scale(${ slideScale })`,
													  }
													: { visibility: 'hidden' }
											}
										/>
									}
								>
									<Menu.Item onClick={ () => ( zoom === null ? zoomTo( 1 ) : resetToFit() ) }>
										{ zoom === null ? __( 'Actual size' ) : __( 'Fit to window' ) }
									</Menu.Item>
									{ images.length > 1 ? (
										<Menu.Item onClick={ () => setIsGridOpen( true ) }>
											{ __( 'All images' ) }
										</Menu.Item>
									) : null }
								</ImageContextMenu>
							</div>
						);
					} ) }
				</div>
			) }
			{ images.length > 1 && ! isGridOpen ? (
				<>
					<IconButton
						variant="unstyled"
						icon={ chevronLeft }
						label={ __( 'Previous image' ) }
						className={ clsx( styles.chromeButton, styles.navButton, styles.navPrev ) }
						onClick={ () => navigate( -1 ) }
					/>
					<IconButton
						variant="unstyled"
						icon={ chevronRight }
						label={ __( 'Next image' ) }
						className={ clsx( styles.chromeButton, styles.navButton, styles.navNext ) }
						onClick={ () => navigate( 1 ) }
					/>
				</>
			) : null }
			<div className={ styles.toolbar }>
				{ images.length > 1 ? (
					<>
						<span className={ styles.counter }>
							{ sprintf(
								/* translators: 1: current image number, 2: total number of images */
								__( '%1$d of %2$d' ),
								index + 1,
								images.length
							) }
						</span>
						<span className={ styles.toolbarDivider } aria-hidden="true" />
					</>
				) : null }
				{ ! isGridOpen ? (
					<>
						<IconButton
							variant="unstyled"
							icon={ lineSolid }
							label={ __( 'Zoom out' ) }
							className={ styles.toolbarButton }
							disabled={ scale === null || fitScale === null || scale <= fitScale + 0.0001 }
							onClick={ () => scale !== null && zoomTo( scale / ZOOM_STEP ) }
						/>
						<Button
							variant="unstyled"
							className={ clsx( styles.toolbarButton, styles.zoomLevel ) }
							title={ zoom === null ? __( 'Actual size' ) : __( 'Fit to window' ) }
							onClick={ () => ( zoom === null ? zoomTo( 1 ) : resetToFit() ) }
						>
							{ scale !== null ? `${ Math.round( scale * 100 ) }%` : '' }
						</Button>
						<IconButton
							variant="unstyled"
							icon={ plus }
							label={ __( 'Zoom in' ) }
							className={ styles.toolbarButton }
							disabled={ scale === null || scale >= MAX_SCALE - 0.0001 }
							onClick={ () => scale !== null && zoomTo( scale * ZOOM_STEP ) }
						/>
						<span className={ styles.toolbarDivider } aria-hidden="true" />
					</>
				) : null }
				{ images.length > 1 ? (
					<>
						<IconButton
							variant="unstyled"
							icon={ gallery }
							label={ isGridOpen ? __( 'Back to image' ) : __( 'All images' ) }
							className={ clsx( styles.toolbarButton, isGridOpen && styles.toolbarButtonActive ) }
							onClick={ () => setIsGridOpen( ( open ) => ! open ) }
						/>
						<span className={ styles.toolbarDivider } aria-hidden="true" />
					</>
				) : null }
				<IconButton
					variant="unstyled"
					icon={ downloadIcon }
					label={ __( 'Download image' ) }
					className={ styles.toolbarButton }
					nativeButton={ false }
					render={ <a href={ image.src } download={ getDownloadFilename( image, index ) } /> }
				/>
			</div>
			<IconButton
				ref={ closeButtonRef }
				variant="unstyled"
				icon={ closeSmall }
				label={ __( 'Close' ) }
				className={ clsx( styles.chromeButton, styles.close ) }
				onClick={ onClose }
			/>
		</div>,
		document.body
	);
}
