import { __ } from '@wordpress/i18n';
import { closeSmall, desktop, external, Icon, redo } from '@wordpress/icons';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
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
	getURL(): string;
	getTitle(): string;
}

interface PreviewWebviewTitleEvent extends Event {
	title?: string;
}

interface DollyPreviewPanelProps {
	selectedSite: SyncSite;
	previewState: DollyPreviewState;
	previewUrl?: string;
	onClose: () => void;
	onRefresh: () => void;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
}

export const DollyPreviewPanelPortal = ( { children }: { children: React.ReactNode } ) => {
	const [ portalRoot, setPortalRoot ] = useState< HTMLElement | null >( () =>
		typeof document === 'undefined'
			? null
			: document.getElementById( 'assistant-preview-panel-root' )
	);

	useEffect( () => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		setPortalRoot( document.getElementById( 'assistant-preview-panel-root' ) );
	}, [] );

	if ( ! portalRoot ) {
		return <>{ children }</>;
	}

	return createPortal( children, portalRoot );
};

export function DollyPreviewPanel( {
	selectedSite,
	previewState,
	previewUrl,
	onClose,
	onRefresh,
	onUpdateState,
}: DollyPreviewPanelProps ) {
	const [ width, setWidth ] = useState( DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH );
	const title = previewState.pageTitle || previewState.title || __( 'Site preview' );
	const displayUrl = previewState.currentUrl || previewUrl || selectedSite.url;

	const handleResizeStart = ( event: React.PointerEvent< HTMLButtonElement > ) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = width;
		const maxWidth = Math.min( DOLLY_PREVIEW_PANEL_MAX_WIDTH, window.innerWidth * 0.65 );

		const handlePointerMove = ( pointerEvent: PointerEvent ) => {
			const nextWidth = startWidth + startX - pointerEvent.clientX;
			setWidth( Math.max( DOLLY_PREVIEW_PANEL_MIN_WIDTH, Math.min( maxWidth, nextWidth ) ) );
		};

		const handlePointerUp = () => {
			window.removeEventListener( 'pointermove', handlePointerMove );
			window.removeEventListener( 'pointerup', handlePointerUp );
		};

		window.addEventListener( 'pointermove', handlePointerMove );
		window.addEventListener( 'pointerup', handlePointerUp );
	};

	return (
		<aside
			className="relative h-full shrink-0 border-l border-a8c-gray-5 bg-white flex flex-col"
			style={ { width } }
			aria-label={ __( 'Assistant site preview' ) }
		>
			<button
				type="button"
				className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize border-0 bg-transparent p-0"
				aria-label={ __( 'Resize site preview' ) }
				aria-orientation="vertical"
				role="separator"
				onPointerDown={ handleResizeStart }
			/>
			<div className="h-12 shrink-0 border-b border-a8c-gray-5 px-3 flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] leading-4 font-medium text-frame-text">
						{ title }
					</div>
					<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
				</div>
				<Button
					variant="icon"
					tooltipText={ __( 'Reload preview' ) }
					disabled={ ! previewUrl }
					onClick={ onRefresh }
					aria-label={ __( 'Reload preview' ) }
				>
					<Icon icon={ redo } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Open in browser' ) }
					disabled={ ! previewUrl }
					onClick={ () => getIpcApi().openURL( previewState.currentUrl || previewUrl || '' ) }
					aria-label={ __( 'Open in browser' ) }
				>
					<Icon icon={ external } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Close preview' ) }
					onClick={ onClose }
					aria-label={ __( 'Close preview' ) }
				>
					<Icon icon={ closeSmall } size={ 20 } />
				</Button>
			</div>
			<div className="relative min-h-0 flex-1 bg-a8c-gray-0">
				{ previewUrl ? (
					isElectron() ? (
						<DollyPreviewWebview
							key={ selectedSite.id }
							url={ previewUrl }
							reloadNonce={ previewState.reloadNonce }
							onUpdateState={ onUpdateState }
						/>
					) : (
						<iframe
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
	onUpdateState,
}: {
	url: string;
	reloadNonce: number;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
} ) {
	const ref = useRef< HTMLElement | null >( null );
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
