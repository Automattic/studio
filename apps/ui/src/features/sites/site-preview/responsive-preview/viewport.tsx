import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { updateResponsivePreview, type ResponsivePreviewSettings } from '@/data/responsive-preview';
import { PreviewParticles } from '@/features/sites/preview-particles';
import { clampDimension } from './settings';
import styles from './style.module.css';
import {
	useResponsivePreviewTracks,
	type ResponsivePreviewSize,
} from './use-responsive-preview-tracks';

const edges = [ 'n', 'e', 's', 'w' ] as const;
const getEdgeNames = () => ( {
	n: __( 'Top' ),
	e: __( 'Right' ),
	s: __( 'Bottom' ),
	w: __( 'Left' ),
} );

export function ResponsiveViewport( {
	siteId,
	settings,
	scale = 1,
	active = true,
	children,
}: {
	siteId?: string;
	settings?: ResponsivePreviewSettings;
	scale?: number;
	active?: boolean;
	children: ReactNode;
} ) {
	const [ dragScale, setDragScale ] = useState< number | null >( null );
	const [ draggingEdge, setDraggingEdge ] = useState< string | null >( null );
	const drag = useRef< {
		pointerId: number;
		x: number;
		y: number;
		start: ResponsivePreviewSize;
		current: ResponsivePreviewSize;
		scale: number;
		widthFactor: number;
		heightFactor: number;
	} | null >( null );
	const keyboard = useRef< {
		key: string;
		start: ResponsivePreviewSize;
		current: ResponsivePreviewSize;
	} | null >( null );
	const enabled = !! settings?.enabled;
	const track = useResponsivePreviewTracks( active && enabled );
	useLayoutEffect( () => {
		drag.current = null;
		keyboard.current = null;
		setDragScale( null );
		setDraggingEdge( null );
	}, [ siteId, enabled, active ] );
	const displayScale = dragScale ?? scale;
	const resize = ( width: number, height: number ) => {
		const next = {
			width: clampDimension( width ),
			height: clampDimension( height ),
			preset: 'responsive',
		};
		if ( siteId ) updateResponsivePreview( siteId, next );
		return next;
	};
	const cancelDrag = () => {
		drag.current = null;
		setDragScale( null );
		setDraggingEdge( null );
	};
	const finishKeyboardResize = () => {
		const gesture = keyboard.current;
		keyboard.current = null;
		if ( gesture ) track( 'manual_resize', gesture.start, gesture.current );
	};
	return (
		<div
			className={ clsx( styles.viewport, enabled && styles.enabled ) }
			data-responsive-viewport={ enabled || undefined }
		>
			<div
				className={ styles.canvas }
				style={
					enabled
						? {
								width: `max(100%, ${ settings.width * displayScale + 32 }px)`,
								height: `max(100%, ${ settings.height * displayScale + 32 }px)`,
						  }
						: undefined
				}
			>
				{ enabled && <PreviewParticles fade={ false } /> }
				<div
					className={ styles.stage }
					style={
						enabled
							? { width: settings.width * displayScale, height: settings.height * displayScale }
							: undefined
					}
				>
					<div
						className={ styles.page }
						style={
							enabled
								? {
										width: settings.width,
										height: settings.height,
										transform: `scale(${ displayScale })`,
								  }
								: undefined
						}
					>
						{ children }
					</div>
					{ enabled &&
						edges.map( ( edge ) => (
							<div
								key={ edge }
								className={ styles.handle }
								data-edge={ edge }
								data-dragging={ draggingEdge === edge || undefined }
								role="button"
								tabIndex={ 0 }
								aria-label={ sprintf(
									/* translators: %s: viewport edge direction. */ __( 'Resize viewport: %s' ),
									getEdgeNames()[ edge ]
								) }
								onPointerDown={ ( event ) => {
									if ( ! active || ! siteId || event.button !== 0 || drag.current ) return;
									finishKeyboardResize();
									event.preventDefault();
									event.currentTarget.setPointerCapture( event.pointerId );
									const viewport = event.currentTarget.closest< HTMLElement >(
										'[data-responsive-viewport]'
									);
									drag.current = {
										pointerId: event.pointerId,
										x: event.clientX,
										y: event.clientY,
										start: settings,
										current: settings,
										scale: displayScale,
										// Centered edges move half the total size change; overflowing edges move all of it.
										widthFactor:
											viewport?.clientWidth &&
											settings.width * displayScale + 32 > viewport.clientWidth
												? 1
												: 2,
										heightFactor:
											viewport?.clientHeight &&
											settings.height * displayScale + 32 > viewport.clientHeight
												? 1
												: 2,
									};
									setDragScale( displayScale );
									setDraggingEdge( edge );
								} }
								onPointerMove={ ( event ) => {
									const start = drag.current;
									if ( ! start || start.pointerId !== event.pointerId ) return;
									const dx = ( ( event.clientX - start.x ) * start.widthFactor ) / start.scale;
									const dy = ( ( event.clientY - start.y ) * start.heightFactor ) / start.scale;
									start.current = resize(
										start.start.width +
											( edge.includes( 'e' ) ? dx : edge.includes( 'w' ) ? -dx : 0 ),
										start.start.height +
											( edge.includes( 's' ) ? dy : edge.includes( 'n' ) ? -dy : 0 )
									);
								} }
								onPointerUp={ ( event ) => {
									const gesture = drag.current;
									if ( ! gesture || gesture.pointerId !== event.pointerId ) return;
									cancelDrag();
									track( 'manual_resize', gesture.start, gesture.current );
									event.currentTarget.releasePointerCapture( event.pointerId );
								} }
								onLostPointerCapture={ ( event ) => {
									if ( drag.current?.pointerId === event.pointerId ) cancelDrag();
								} }
								onPointerCancel={ ( event ) => {
									if ( drag.current?.pointerId === event.pointerId ) cancelDrag();
								} }
								onKeyDown={ ( event ) => {
									if ( ! active || ! siteId || drag.current ) return;
									const amount = event.shiftKey ? 10 : 1;
									let { width, height } = keyboard.current?.current ?? settings;
									if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
										if ( ! /[ew]/.test( edge ) ) return;
										width +=
											amount *
											( event.key === 'ArrowRight' ? 1 : -1 ) *
											( edge.includes( 'w' ) ? -1 : 1 );
									} else if ( event.key === 'ArrowUp' || event.key === 'ArrowDown' ) {
										if ( ! /[ns]/.test( edge ) ) return;
										height +=
											amount *
											( event.key === 'ArrowDown' ? 1 : -1 ) *
											( edge.includes( 'n' ) ? -1 : 1 );
									} else return;
									event.preventDefault();
									keyboard.current ??= { key: event.key, start: settings, current: settings };
									keyboard.current.current = resize( width, height );
								} }
								onKeyUp={ ( event ) => {
									if ( keyboard.current?.key === event.key ) finishKeyboardResize();
								} }
								onBlur={ finishKeyboardResize }
							/>
						) ) }
					{ enabled && dragScale !== null ? <div className={ styles.dragShield } /> : null }
				</div>
			</div>
		</div>
	);
}
