import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { updateResponsivePreview, type ResponsivePreviewSettings } from '@/data/responsive-preview';
import { clampDimension } from './settings';
import styles from './style.module.css';

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
	children,
}: {
	siteId?: string;
	settings?: ResponsivePreviewSettings;
	scale?: number;
	children: ReactNode;
} ) {
	const [ dragScale, setDragScale ] = useState< number | null >( null );
	const [ draggingEdge, setDraggingEdge ] = useState< string | null >( null );
	const drag = useRef< {
		x: number;
		y: number;
		width: number;
		height: number;
		scale: number;
		widthFactor: number;
		heightFactor: number;
	} | null >( null );
	const enabled = !! settings?.enabled;
	useLayoutEffect( () => {
		drag.current = null;
		setDragScale( null );
		setDraggingEdge( null );
	}, [ siteId, enabled ] );
	const displayScale = dragScale ?? scale;
	const resize = ( width: number, height: number ) => {
		if ( siteId )
			updateResponsivePreview( siteId, {
				width: clampDimension( width ),
				height: clampDimension( height ),
				preset: 'responsive',
			} );
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
									if ( event.button !== 0 ) return;
									event.preventDefault();
									event.currentTarget.setPointerCapture( event.pointerId );
									const viewport = event.currentTarget.closest< HTMLElement >(
										'[data-responsive-viewport]'
									);
									drag.current = {
										x: event.clientX,
										y: event.clientY,
										width: settings.width,
										height: settings.height,
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
									if ( ! start ) return;
									const dx = ( ( event.clientX - start.x ) * start.widthFactor ) / start.scale;
									const dy = ( ( event.clientY - start.y ) * start.heightFactor ) / start.scale;
									resize(
										start.width + ( edge.includes( 'e' ) ? dx : edge.includes( 'w' ) ? -dx : 0 ),
										start.height + ( edge.includes( 's' ) ? dy : edge.includes( 'n' ) ? -dy : 0 )
									);
								} }
								onPointerUp={ ( event ) => {
									drag.current = null;
									setDragScale( null );
									setDraggingEdge( null );
									event.currentTarget.releasePointerCapture( event.pointerId );
								} }
								onLostPointerCapture={ () => {
									drag.current = null;
									setDragScale( null );
									setDraggingEdge( null );
								} }
								onPointerCancel={ () => {
									drag.current = null;
									setDragScale( null );
									setDraggingEdge( null );
								} }
								onKeyDown={ ( event ) => {
									const amount = event.shiftKey ? 10 : 1;
									let { width, height } = settings;
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
									resize( width, height );
								} }
							/>
						) ) }
					{ enabled && dragScale !== null ? <div className={ styles.dragShield } /> : null }
				</div>
			</div>
		</div>
	);
}
