import { __ } from '@wordpress/i18n';
import { desktop, Icon } from '@wordpress/icons';
import React, { useEffect, useRef, useState } from 'react';
import type { SyncSite } from '@studio/common/types/sync';
import type { DollyPreviewState } from 'src/modules/wpcom-site-assistant/lib/types';

const DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH = 520;
const DOLLY_PREVIEW_PANEL_MIN_WIDTH = 360;
const DOLLY_PREVIEW_PANEL_MAX_WIDTH = 820;

const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) {
		return false;
	}
	return /\bElectron\//.test( navigator.userAgent );
};

interface PreviewWebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	reload(): void;
	goBack(): void;
	goForward(): void;
	canGoBack(): boolean;
	canGoForward(): boolean;
	getURL(): string;
	getTitle(): string;
}

interface PreviewWebviewTitleEvent extends Event {
	title?: string;
}

interface PreviewResizeDrag {
	startX: number;
	startWidth: number;
	maxWidth: number;
}

interface DollyPreviewPanelProps {
	selectedSite: SyncSite;
	previewState: DollyPreviewState;
	previewUrl?: string;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
}

export function DollyPreviewPanel( {
	selectedSite,
	previewState,
	previewUrl,
	onUpdateState,
}: DollyPreviewPanelProps ) {
	const [ width, setWidth ] = useState( DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH );
	const [ resizeDrag, setResizeDrag ] = useState< PreviewResizeDrag | null >( null );
	const resizeHandleRef = useRef< HTMLButtonElement | null >( null );
	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const handledIframeNavigationNonceRef = useRef< number | undefined >();

	const handleResizeStart = ( event: React.PointerEvent< HTMLButtonElement > ) => {
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startWidth = width;
		const maxWidth = Math.min( DOLLY_PREVIEW_PANEL_MAX_WIDTH, window.innerWidth * 0.65 );

		setResizeDrag( { startX, startWidth, maxWidth } );
	};

	useEffect( () => {
		if ( ! resizeDrag ) {
			return;
		}

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;

		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		const finishResize = () => {
			setResizeDrag( null );
			resizeHandleRef.current?.blur();
		};
		const handlePointerMove = ( pointerEvent: PointerEvent ) => {
			pointerEvent.preventDefault();
			const nextWidth = resizeDrag.startWidth + resizeDrag.startX - pointerEvent.clientX;
			setWidth(
				Math.max( DOLLY_PREVIEW_PANEL_MIN_WIDTH, Math.min( resizeDrag.maxWidth, nextWidth ) )
			);
		};

		window.addEventListener( 'pointermove', handlePointerMove, { passive: false } );
		window.addEventListener( 'pointerup', finishResize );
		window.addEventListener( 'pointercancel', finishResize );
		window.addEventListener( 'blur', finishResize );

		return () => {
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
			window.removeEventListener( 'pointermove', handlePointerMove );
			window.removeEventListener( 'pointerup', finishResize );
			window.removeEventListener( 'pointercancel', finishResize );
			window.removeEventListener( 'blur', finishResize );
		};
	}, [ resizeDrag ] );

	useEffect( () => {
		const navigationNonce = previewState.navigationNonce ?? 0;
		if (
			isElectron() ||
			! previewState.navigationAction ||
			! navigationNonce ||
			handledIframeNavigationNonceRef.current === navigationNonce
		) {
			return;
		}

		handledIframeNavigationNonceRef.current = navigationNonce;
		try {
			if ( previewState.navigationAction === 'back' ) {
				iframeRef.current?.contentWindow?.history.back();
			} else {
				iframeRef.current?.contentWindow?.history.forward();
			}
		} catch {
			// Cross-origin iframe history access is browser-dependent; Electron webviews handle this.
		}
		onUpdateState( { navigationAction: undefined } );
	}, [ onUpdateState, previewState.navigationAction, previewState.navigationNonce ] );

	return (
		<aside
			className="relative h-full shrink-0 border-l border-a8c-gray-5 bg-white flex flex-col"
			style={ { width } }
			aria-label={ __( 'Assistant site preview' ) }
		>
			<button
				ref={ resizeHandleRef }
				type="button"
				className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize border-0 bg-transparent p-0"
				aria-label={ __( 'Resize site preview' ) }
				aria-orientation="vertical"
				role="separator"
				onPointerDown={ handleResizeStart }
			/>
			{ resizeDrag && (
				<div
					data-testid="wpcom-preview-resize-capture"
					className="fixed inset-0 z-[9999] cursor-col-resize select-none"
					aria-hidden="true"
				/>
			) }
			<div className="relative min-h-0 flex-1 bg-a8c-gray-0">
				{ previewUrl ? (
					isElectron() ? (
						<DollyPreviewWebview
							key={ selectedSite.id }
							url={ previewUrl }
							reloadNonce={ previewState.reloadNonce }
							previewState={ previewState }
							onUpdateState={ onUpdateState }
						/>
					) : (
						<iframe
							ref={ iframeRef }
							key={ `${ previewUrl }#${ previewState.reloadNonce }` }
							className="absolute inset-0 h-full w-full border-0 bg-white"
							src={ previewUrl }
							title={ `${ selectedSite.name } preview` }
							onLoad={ () =>
								onUpdateState( {
									currentUrl: previewUrl,
									isLoading: false,
								} )
							}
						/>
					)
				) : (
					<div className="h-full p-6 flex flex-col items-center justify-center gap-3 text-center">
						<Icon icon={ desktop } size={ 32 } className="fill-frame-text-secondary" />
						<div>
							<div className="text-sm font-medium text-frame-text">
								{ __( 'Preview needs a valid WordPress.com site URL.' ) }
							</div>
							<div className="mt-1 text-xs text-frame-text-secondary">
								{ __( 'Dolly previews the live WordPress.com site that it can manage.' ) }
							</div>
						</div>
					</div>
				) }
				{ previewState.isLoading && previewUrl ? (
					<div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-a8c-gray-5">
						<div className="h-full w-1/2 animate-pulse bg-frame-theme" />
					</div>
				) : null }
			</div>
		</aside>
	);
}

function DollyPreviewWebview( {
	url,
	reloadNonce,
	previewState,
	onUpdateState,
}: {
	url: string;
	reloadNonce: number;
	previewState: DollyPreviewState;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
} ) {
	const ref = useRef< HTMLElement | null >( null );
	const handledNavigationNonceRef = useRef< number | undefined >();
	const [ ready, setReady ] = useState( false );
	const [ initialNav ] = useState( () => ( { url, reloadNonce } ) );

	useEffect( () => {
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}

		const updateFromWebview = ( nextState: Partial< DollyPreviewState > = {} ) => {
			onUpdateState( {
				currentUrl: webview.getURL?.() || url,
				pageTitle: webview.getTitle?.() || undefined,
				canGoBack: webview.canGoBack?.() ?? false,
				canGoForward: webview.canGoForward?.() ?? false,
				...nextState,
			} );
		};

		const handleDomReady = () => {
			setReady( true );
			updateFromWebview();
		};
		const handleStartLoading = () => onUpdateState( { isLoading: true } );
		const handleStopLoading = () => updateFromWebview( { isLoading: false } );
		const handleTitleUpdated = ( event: Event ) => {
			const titleEvent = event as PreviewWebviewTitleEvent;
			onUpdateState( { pageTitle: titleEvent.title } );
		};

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'did-start-loading', handleStartLoading );
		webview.addEventListener( 'did-stop-loading', handleStopLoading );
		webview.addEventListener( 'did-navigate', handleStopLoading );
		webview.addEventListener( 'did-navigate-in-page', handleStopLoading );
		webview.addEventListener( 'page-title-updated', handleTitleUpdated );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'did-start-loading', handleStartLoading );
			webview.removeEventListener( 'did-stop-loading', handleStopLoading );
			webview.removeEventListener( 'did-navigate', handleStopLoading );
			webview.removeEventListener( 'did-navigate-in-page', handleStopLoading );
			webview.removeEventListener( 'page-title-updated', handleTitleUpdated );
		};
	}, [ onUpdateState, url ] );

	useEffect( () => {
		const navigationNonce = previewState.navigationNonce ?? 0;
		if (
			! ready ||
			! previewState.navigationAction ||
			! navigationNonce ||
			handledNavigationNonceRef.current === navigationNonce
		) {
			return;
		}

		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}

		handledNavigationNonceRef.current = navigationNonce;
		const canNavigate =
			previewState.navigationAction === 'back' ? webview.canGoBack?.() : webview.canGoForward?.();

		if ( canNavigate ) {
			onUpdateState( { isLoading: true, navigationAction: undefined } );
			if ( previewState.navigationAction === 'back' ) {
				webview.goBack();
			} else {
				webview.goForward();
			}
			return;
		}

		onUpdateState( {
			navigationAction: undefined,
			canGoBack: webview.canGoBack?.() ?? false,
			canGoForward: webview.canGoForward?.() ?? false,
		} );
	}, [ onUpdateState, previewState.navigationAction, previewState.navigationNonce, ready ] );

	useEffect( () => {
		if ( ! ready ) {
			return;
		}
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}
		if ( url === initialNav.url && reloadNonce === initialNav.reloadNonce ) {
			return;
		}
		onUpdateState( { isLoading: true } );
		webview.loadURL( url ).catch( () => onUpdateState( { isLoading: false } ) );
	}, [ initialNav.reloadNonce, initialNav.url, onUpdateState, ready, reloadNonce, url ] );

	return (
		<webview
			ref={ ref }
			src={ initialNav.url }
			className="absolute inset-0 h-full w-full border-0 bg-white"
			allowpopups="true"
			partition="persist:site-preview"
		/>
	);
}
