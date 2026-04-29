import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { Annotation } from './types';
import type { SiteDetails } from '@/data/core';

export type { Annotation } from './types';

interface SitePreviewProps {
	site: SiteDetails;
	// When present, the preview subscribes to the agent event stream for this
	// session and reacts to `preview.command` events emitted by the agent's
	// preview_navigate / preview_reload tools.
	sessionId?: string;
	// Called when the user clicks "Done" in the inspector toolbar (rendered
	// inside the WebContentsView). Receives the full annotation payload.
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
}

interface InspectorEvent {
	type: 'done';
	annotations?: Annotation[];
}

export function SitePreview( { site, sessionId, onAnnotationsDone }: SitePreviewProps ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;
	const [ currentPath, setCurrentPath ] = useState( '/' );
	const [ reloadNonce, setReloadNonce ] = useState( 0 );
	const fullUrl = `${ siteUrl }${ currentPath }`;

	useEffect( () => {
		if ( ! sessionId ) return;
		return connector.onAgentEvent( ( payload ) => {
			if ( payload.sessionId !== sessionId ) return;
			const event = payload.event;
			if ( event.type !== 'preview.command' ) return;
			if ( event.kind === 'navigate' ) {
				setCurrentPath( event.path );
			}
			setReloadNonce( ( n ) => n + 1 );
		} );
	}, [ connector, sessionId ] );

	return (
		<aside className={ styles.root } aria-label={ __( 'Site preview' ) }>
			<div className={ styles.header }>
				<div className={ styles.trafficLights } aria-hidden="true">
					<span className={ clsx( styles.trafficLight, styles.trafficLightActive ) } />
					<span className={ styles.trafficLight } />
					<span className={ styles.trafficLight } />
				</div>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<span className={ styles.separator } aria-hidden="true" />
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ external }
					label={ __( 'Open site in browser' ) }
					disabled={ ! canPreview }
					onClick={ () => void connector.openExternalUrl( fullUrl ) }
				/>
			</div>
			<div className={ styles.body }>
				{ canPreview ? (
					connector.previewView ? (
						<WebContentsViewSurface
							key={ site.id }
							siteId={ site.id }
							path={ currentPath }
							reloadNonce={ reloadNonce }
							previewView={ connector.previewView }
							onAnnotationsDone={ onAnnotationsDone }
						/>
					) : (
						// Non-Electron fallback: plain iframe, no inspector.
						<iframe
							key={ `${ fullUrl }#${ reloadNonce }` }
							className={ styles.iframe }
							src={ fullUrl }
							title={ site.name }
						/>
					)
				) : (
					<div className={ styles.empty }>
						<p className={ styles.emptyText }>{ __( 'Start the site to see a live preview.' ) }</p>
						<Button
							variant="solid"
							tone="brand"
							loading={ isStarting }
							loadingAnnouncement={ __( 'Starting site' ) }
							onClick={ () => startSite.mutate( site.id ) }
						>
							<span className={ styles.startIcon } aria-hidden="true">
								{ playIcon }
							</span>
							{ __( 'Start site' ) }
						</Button>
					</div>
				) }
			</div>
		</aside>
	);
}

interface WebContentsViewSurfaceProps {
	siteId: string;
	path: string;
	reloadNonce: number;
	previewView: NonNullable< ReturnType< typeof useConnector >[ 'previewView' ] >;
	onAnnotationsDone?: ( annotations: Annotation[] ) => void;
}

/**
 * Mounts a Studio `WebContentsView` over the placeholder div, keeps its
 * bounds in sync with the placeholder, and tears it down on unmount.
 *
 * The view is a native overlay — it always paints on top of HTML in the
 * same window — so the inspector's toolbar UI lives inside the view's
 * page rather than as a React overlay.
 */
function WebContentsViewSurface( {
	siteId,
	path,
	reloadNonce,
	previewView,
	onAnnotationsDone,
}: WebContentsViewSurfaceProps ) {
	const placeholderRef = useRef< HTMLDivElement | null >( null );
	const viewIdRef = useRef< string | null >( null );
	const latestNavigationRef = useRef( { path, reloadNonce } );
	const [ ready, setReady ] = useState( false );
	const onAnnotationsDoneRef = useRef( onAnnotationsDone );
	useEffect( () => {
		onAnnotationsDoneRef.current = onAnnotationsDone;
	}, [ onAnnotationsDone ] );
	useEffect( () => {
		latestNavigationRef.current = { path, reloadNonce };
	}, [ path, reloadNonce ] );

	// Lifecycle: create on mount, sync bounds, destroy on unmount. Navigation
	// happens through a separate typed command so the main process keeps
	// ownership of URL resolution and validation.
	useEffect( () => {
		const node = placeholderRef.current;
		if ( ! node ) return;

		let cancelled = false;
		let resizeObserver: ResizeObserver | null = null;
		let scrollListener: ( () => void ) | null = null;
		const initialBounds = node.getBoundingClientRect();
		// WebContentsView ignores parent CSS clipping, so read the host
		// container's border-radius and pass it down — the native view
		// applies it via setBorderRadius. Falls back to 0 if unparseable.
		const containerRadius = parseFloat(
			window.getComputedStyle( node.closest( 'aside' ) ?? node ).borderRadius || '0'
		);
		const initialNavigation = latestNavigationRef.current;

		void previewView
			.create( {
				siteId,
				path: initialNavigation.path,
				bounds: {
					x: initialBounds.left,
					y: initialBounds.top,
					width: initialBounds.width,
					height: initialBounds.height,
				},
				enableInspector: true,
				borderRadius: Number.isFinite( containerRadius ) ? containerRadius : 0,
			} )
			.then( ( { viewId } ) => {
				if ( cancelled ) {
					void previewView.destroy( viewId );
					return;
				}
				viewIdRef.current = viewId;
				setReady( true );
				const latestNavigation = latestNavigationRef.current;
				if (
					latestNavigation.path !== initialNavigation.path ||
					latestNavigation.reloadNonce !== initialNavigation.reloadNonce
				) {
					void previewView.navigate( viewId, latestNavigation.path );
				}

				const syncBounds = () => {
					if ( ! placeholderRef.current ) return;
					const rect = placeholderRef.current.getBoundingClientRect();
					void previewView.setBounds( viewId, {
						x: rect.left,
						y: rect.top,
						width: rect.width,
						height: rect.height,
					} );
				};

				// `ResizeObserver` covers placeholder size changes (window
				// resize, sidebar collapse, …). Window-level scroll covers
				// the case where the placeholder moves without resizing.
				resizeObserver = new ResizeObserver( syncBounds );
				resizeObserver.observe( node );
				scrollListener = syncBounds;
				window.addEventListener( 'scroll', scrollListener, true );
				window.addEventListener( 'resize', scrollListener );
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setReady( true );
				}
			} );

		return () => {
			cancelled = true;
			resizeObserver?.disconnect();
			if ( scrollListener ) {
				window.removeEventListener( 'scroll', scrollListener, true );
				window.removeEventListener( 'resize', scrollListener );
			}
			const viewId = viewIdRef.current;
			viewIdRef.current = null;
			if ( viewId ) {
				void previewView.destroy( viewId );
			}
		};
	}, [ previewView, siteId ] );

	useEffect( () => {
		const viewId = viewIdRef.current;
		if ( ! viewId ) return;
		void previewView.navigate( viewId, path );
	}, [ path, previewView, reloadNonce ] );

	// Subscribe once for inspector events; route by viewId so the listener
	// survives re-mounts under the same connector.
	useEffect( () => {
		return previewView.onEvent( ( { viewId, payload } ) => {
			if ( viewId !== viewIdRef.current ) return;
			const event = payload as InspectorEvent | null;
			if ( ! event ) return;
			if ( event.type === 'done' && event.annotations ) {
				onAnnotationsDoneRef.current?.( event.annotations );
			}
		} );
	}, [ previewView ] );

	return (
		<>
			<div ref={ placeholderRef } className={ styles.iframe } />
			{ ! ready ? (
				<div className={ styles.spinnerOverlay } aria-hidden="true">
					<span className={ styles.spinner } />
				</div>
			) : null }
		</>
	);
}
