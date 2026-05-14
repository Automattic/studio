import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createShapeId } from 'tldraw';
import { useSites } from '@/data/queries/use-sites';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import {
	ANNOTATION_INSPECTOR_BRIDGE_PREFIX,
	ANNOTATION_INSPECTOR_CLEANUP_SCRIPT,
	ANNOTATION_INSPECTOR_SCRIPT,
	mountInspector,
	type AnnotationInspectorEvent,
	type AnnotationPayload,
} from '../annotation-inspector';
import { getSitePreviewUrl, urlLabelFor, withPreviewFlag } from '../url';
import styles from './style.module.css';
import type { SitePreviewWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type SitePreviewWidgetComponentProps = DeskWidgetComponentProps< SitePreviewWidgetProps >;

interface WebviewTag extends HTMLElement {
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	getURL?: () => string;
}

interface WebviewConsoleEvent extends Event {
	message: string;
}

interface WebviewNavigationEvent extends Event {
	url?: string;
}

const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) {
		return false;
	}
	return /\bElectron\//.test( navigator.userAgent );
};

export function SitePreviewWidgetComponent( {
	id,
	widgetProps,
	isEditing,
	isHovered,
	isSelected,
}: SitePreviewWidgetComponentProps ) {
	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const { siteId, annotatingPreviewShapeId, requestAnnotation } = useDesk();
	const { data: sites, isLoading } = useSites();
	const shapeId = createShapeId( id );
	const isAnnotating = annotatingPreviewShapeId === shapeId;
	const site = sites?.find( ( currentSite ) => currentSite.id === siteId );
	const sitePreviewUrl = getSitePreviewUrl( site, widgetProps.path );
	const previewFrameUrl = sitePreviewUrl ? withPreviewFlag( sitePreviewUrl ) : '';
	const [ liveUrl, setLiveUrl ] = useState( sitePreviewUrl );
	const [ isFrameLoading, setIsFrameLoading ] = useState( false );

	useEffect( () => {
		setLiveUrl( sitePreviewUrl );
	}, [ sitePreviewUrl ] );

	useEffect( () => {
		setIsFrameLoading( Boolean( previewFrameUrl ) );
	}, [ previewFrameUrl ] );

	const handleIframeLoad = () => {
		setIsFrameLoading( false );
		try {
			const href = iframeRef.current?.contentWindow?.location.href;
			if ( href ) {
				setLiveUrl( href );
			}
		} catch {
			// Cross-origin navigation is expected for local sites in Electron.
		}
	};

	useEffect( () => {
		if ( ! isAnnotating || isElectron() ) {
			return;
		}
		const iframe = iframeRef.current;
		if ( ! iframe ) {
			return;
		}

		let teardown: ( () => void ) | null = null;
		const attach = () => {
			teardown?.();
			teardown = null;
			try {
				const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
				if ( ! doc ) {
					return;
				}
				teardown = mountInspector( doc, ( payload ) => {
					requestAnnotation( shapeId, payload );
				} );
			} catch {
				// Electron uses webview injection for cross-origin local sites.
			}
		};

		attach();
		iframe.addEventListener( 'load', attach );
		return () => {
			iframe.removeEventListener( 'load', attach );
			teardown?.();
		};
	}, [ isAnnotating, requestAnnotation, shapeId ] );

	const emptyMessage = getEmptyMessage( {
		hasSiteId: Boolean( siteId ),
		isLoading,
		hasSite: Boolean( site ),
		isRunning: Boolean( site?.running ),
	} );
	const urlLabel = urlLabelFor( liveUrl );

	return (
		<div
			className={ styles.wrapper }
			data-studio-desk-widget="site-preview"
			data-studio-desk-widget-id={ id }
		>
			{ urlLabel && (
				<div
					className={ styles.url }
					data-visible={ isHovered || isSelected || isAnnotating ? 'true' : 'false' }
					title={ urlLabel }
				>
					{ urlLabel }
				</div>
			) }
			<div
				className={ styles.preview }
				data-is-editing={ isEditing ? 'true' : 'false' }
				data-is-annotating={ isAnnotating ? 'true' : 'false' }
			>
				{ previewFrameUrl ? (
					<>
						{ isElectron() ? (
							<WebviewSurface
								key={ previewFrameUrl }
								url={ previewFrameUrl }
								isAnnotating={ isAnnotating }
								onAnnotationPick={ ( payload ) => requestAnnotation( shapeId, payload ) }
								onLoadedUrl={ setLiveUrl }
								onLoadComplete={ () => setIsFrameLoading( false ) }
							/>
						) : (
							<iframe
								ref={ iframeRef }
								className={ styles.frame }
								src={ previewFrameUrl }
								title={ __( 'Site preview' ) }
								sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
								referrerPolicy="no-referrer"
								onLoad={ handleIframeLoad }
							/>
						) }
						{ isFrameLoading && (
							<div className={ styles.loading }>
								<LoadingPlaceholder text={ __( 'Loading site preview' ) } />
							</div>
						) }
					</>
				) : (
					<div className={ isLoading ? styles.loading : styles.empty }>
						{ isLoading ? (
							<LoadingPlaceholder text={ __( 'Loading site preview' ) } />
						) : (
							emptyMessage
						) }
					</div>
				) }
				{ ! isEditing && ! isAnnotating && <div className={ styles.shield } aria-hidden="true" /> }
			</div>
		</div>
	);
}

interface WebviewSurfaceProps {
	url: string;
	isAnnotating: boolean;
	onAnnotationPick: ( payload: AnnotationPayload ) => void;
	onLoadedUrl: ( url: string ) => void;
	onLoadComplete: () => void;
}

function WebviewSurface( {
	url,
	isAnnotating,
	onAnnotationPick,
	onLoadedUrl,
	onLoadComplete,
}: WebviewSurfaceProps ) {
	const ref = useRef< HTMLElement | null >( null );
	const isAnnotatingRef = useRef( isAnnotating );
	const isWebviewReadyRef = useRef( false );
	const onAnnotationPickRef = useRef( onAnnotationPick );
	const onLoadedUrlRef = useRef( onLoadedUrl );
	const onLoadCompleteRef = useRef( onLoadComplete );

	useEffect( () => {
		isAnnotatingRef.current = isAnnotating;
	}, [ isAnnotating ] );

	useEffect( () => {
		onAnnotationPickRef.current = onAnnotationPick;
		onLoadedUrlRef.current = onLoadedUrl;
		onLoadCompleteRef.current = onLoadComplete;
	}, [ onAnnotationPick, onLoadComplete, onLoadedUrl ] );

	const executeAnnotationScript = useCallback( ( active: boolean ) => {
		const webview = ref.current as WebviewTag | null;
		if ( ! webview || ! isWebviewReadyRef.current ) {
			return;
		}

		try {
			webview
				.executeJavaScript(
					active ? ANNOTATION_INSPECTOR_SCRIPT : ANNOTATION_INSPECTOR_CLEANUP_SCRIPT,
					false
				)
				.catch( () => undefined );
		} catch {
			// Electron throws synchronously if the webview loses readiness mid-call.
		}
	}, [] );

	useEffect( () => {
		const webview = ref.current as WebviewTag | null;
		if ( ! webview ) {
			return;
		}
		syncWebviewInternalFrameSize( webview );
		requestAnimationFrame( () => syncWebviewInternalFrameSize( webview ) );

		const readUrl = ( event?: Event ) => {
			const eventUrl = ( event as WebviewNavigationEvent | undefined )?.url;
			let currentUrl = eventUrl;
			try {
				currentUrl = currentUrl || webview.getURL?.();
			} catch {
				currentUrl = undefined;
			}
			if ( currentUrl ) {
				onLoadedUrlRef.current( currentUrl );
			}
		};
		const handleStartedLoading = () => {
			isWebviewReadyRef.current = false;
		};
		const handleReady = () => {
			syncWebviewInternalFrameSize( webview );
			isWebviewReadyRef.current = true;
			onLoadCompleteRef.current();
			readUrl();
			executeAnnotationScript( isAnnotatingRef.current );
		};
		const handleNavigation = ( event: Event ) => {
			readUrl( event );
		};
		const handleConsoleMessage = ( event: Event ) => {
			const message = ( event as WebviewConsoleEvent ).message;
			if (
				typeof message !== 'string' ||
				! message.startsWith( ANNOTATION_INSPECTOR_BRIDGE_PREFIX )
			) {
				return;
			}
			let parsed: AnnotationInspectorEvent | null = null;
			try {
				parsed = JSON.parse( message.slice( ANNOTATION_INSPECTOR_BRIDGE_PREFIX.length ) );
			} catch {
				return;
			}
			if ( parsed?.type === 'pick' && parsed.payload ) {
				onAnnotationPickRef.current( parsed.payload );
			}
		};

		webview.addEventListener( 'did-start-loading', handleStartedLoading );
		webview.addEventListener( 'dom-ready', handleReady );
		webview.addEventListener( 'did-finish-load', handleReady );
		webview.addEventListener( 'did-navigate', handleNavigation );
		webview.addEventListener( 'did-navigate-in-page', handleNavigation );
		webview.addEventListener( 'console-message', handleConsoleMessage );
		return () => {
			webview.removeEventListener( 'did-start-loading', handleStartedLoading );
			webview.removeEventListener( 'dom-ready', handleReady );
			webview.removeEventListener( 'did-finish-load', handleReady );
			webview.removeEventListener( 'did-navigate', handleNavigation );
			webview.removeEventListener( 'did-navigate-in-page', handleNavigation );
			webview.removeEventListener( 'console-message', handleConsoleMessage );
			executeAnnotationScript( false );
			isWebviewReadyRef.current = false;
		};
	}, [ executeAnnotationScript ] );

	useEffect( () => {
		executeAnnotationScript( isAnnotating );
	}, [ executeAnnotationScript, isAnnotating ] );

	return (
		<webview
			ref={ ref }
			className={ styles.frame }
			src={ url }
			title={ __( 'Site preview' ) }
			allowpopups="true"
			partition="persist:site-preview"
		/>
	);
}

function syncWebviewInternalFrameSize( webview: HTMLElement ) {
	const internalFrame =
		webview.querySelector( 'iframe' ) ?? webview.shadowRoot?.querySelector( 'iframe' );
	if ( ! ( internalFrame instanceof HTMLElement ) ) {
		return;
	}

	internalFrame.style.width = '100%';
	internalFrame.style.height = '100%';
}

export function SitePreviewWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< SitePreviewWidgetProps > ) {
	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget="site-preview"
			data-studio-desk-widget-id={ id }
		>
			<div className={ styles.thumbnailDomain }>{ formatPathLabel( widgetProps.path ) }</div>
		</div>
	);
}

function getEmptyMessage( {
	hasSiteId,
	isLoading,
	hasSite,
	isRunning,
}: {
	hasSiteId: boolean;
	isLoading: boolean;
	hasSite: boolean;
	isRunning: boolean;
} ) {
	if ( ! hasSiteId ) {
		return __( 'Site preview unavailable' );
	}

	if ( isLoading ) {
		return __( 'Loading site…' );
	}

	if ( ! hasSite ) {
		return __( 'Site not found.' );
	}

	if ( ! isRunning ) {
		return __( 'Start the site to see a live preview.' );
	}

	return __( 'Site preview unavailable' );
}

function formatPathLabel( path: string ) {
	const trimmed = path.trim();
	if ( ! trimmed || trimmed === '/' ) {
		return __( 'Site' );
	}

	return trimmed.startsWith( '/' ) ? trimmed : `/${ trimmed }`;
}
