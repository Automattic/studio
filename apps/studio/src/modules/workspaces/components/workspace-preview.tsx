import { __ } from '@wordpress/i18n';
import {
	chevronLeft,
	chevronRight,
	closeSmall,
	desktop,
	external,
	Icon,
	lockSmall,
	rotateRight,
} from '@wordpress/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

const DEFAULT_PREVIEW_WIDTH = 520;
const MIN_PREVIEW_WIDTH = 360;
const MAX_PREVIEW_WIDTH = 920;
const PREVIEW_TOP_OFFSET = 40;

type WorkspacePreviewNavigationAction = 'back' | 'forward';

type WorkspacePreviewWebview = HTMLElement & {
	canGoBack?: () => boolean;
	canGoForward?: () => boolean;
	getURL?: () => string;
	goBack?: () => void;
	goForward?: () => void;
};

function clampPreviewWidth( width: number ) {
	return Math.min( MAX_PREVIEW_WIDTH, Math.max( MIN_PREVIEW_WIDTH, Math.round( width ) ) );
}

export type WorkspacePreviewState = {
	open: boolean;
	pathOrUrl: string;
	reloadNonce: number;
	width: number;
	canGoBack: boolean;
	canGoForward: boolean;
	currentUrl?: string;
	navigationAction?: WorkspacePreviewNavigationAction;
	navigationActionId: number;
};

export type WorkspacePreviewTarget = {
	siteName: string;
	siteUrl: string;
	isLoading?: boolean;
	onShowPreview?: () => Promise< void > | void;
};

type WorkspacePreviewControlsProps = {
	target: WorkspacePreviewTarget;
	previewState: WorkspacePreviewState;
	onUpdatePreviewState: ( state: WorkspacePreviewState ) => void;
};

type WorkspacePreviewPanelProps = {
	siteName: string;
	previewUrl: string;
	reloadNonce: number;
	width: number;
	navigationAction?: WorkspacePreviewNavigationAction;
	navigationActionId: number;
	onResize: ( width: number ) => void;
	onNavigationStateChange: ( state: {
		canGoBack: boolean;
		canGoForward: boolean;
		currentUrl?: string;
	} ) => void;
};

export const createDefaultWorkspacePreviewState = (): WorkspacePreviewState => ( {
	open: false,
	pathOrUrl: '/',
	reloadNonce: 0,
	width: DEFAULT_PREVIEW_WIDTH,
	canGoBack: false,
	canGoForward: false,
	navigationActionId: 0,
} );

export function resolveWorkspacePreviewUrl( siteUrl: string, pathOrUrl: string ) {
	try {
		return new URL( pathOrUrl, siteUrl ).toString();
	} catch {
		return siteUrl;
	}
}

export function WorkspacePreviewControls( {
	target,
	previewState,
	onUpdatePreviewState,
}: WorkspacePreviewControlsProps ) {
	const previewUrl = resolveWorkspacePreviewUrl( target.siteUrl, previewState.pathOrUrl );
	const displayUrl = previewState.currentUrl ?? previewUrl;
	const showPreview = async () => {
		await target.onShowPreview?.();
		onUpdatePreviewState( {
			...previewState,
			currentUrl: previewUrl,
			open: true,
		} );
	};
	const navigatePreview = ( action: WorkspacePreviewNavigationAction ) => {
		onUpdatePreviewState( {
			...previewState,
			navigationAction: action,
			navigationActionId: previewState.navigationActionId + 1,
		} );
	};

	if ( ! previewState.open ) {
		return (
			<button
				type="button"
				className="flex w-full min-w-0 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2 text-left transition hover:border-a8c-gray-20 hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme disabled:cursor-default disabled:opacity-60"
				onClick={ showPreview }
				aria-label={ __( 'Show preview' ) }
				disabled={ target.isLoading }
			>
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<span className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</span>
			</button>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center justify-end gap-2">
			<Button
				variant="icon"
				tooltipText={ __( 'Back' ) }
				onClick={ () => navigatePreview( 'back' ) }
				aria-label={ __( 'Back' ) }
				disabled={ ! previewState.canGoBack }
			>
				<Icon icon={ chevronLeft } size={ 18 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Forward' ) }
				onClick={ () => navigatePreview( 'forward' ) }
				aria-label={ __( 'Forward' ) }
				disabled={ ! previewState.canGoForward }
			>
				<Icon icon={ chevronRight } size={ 18 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Reload preview' ) }
				onClick={ () =>
					onUpdatePreviewState( {
						...previewState,
						reloadNonce: previewState.reloadNonce + 1,
					} )
				}
				aria-label={ __( 'Reload preview' ) }
			>
				<Icon icon={ rotateRight } size={ 18 } />
			</Button>
			<div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2">
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
			</div>
			<Button
				variant="icon"
				tooltipText={ __( 'Open in browser' ) }
				onClick={ () => getIpcApi().openURL( previewUrl ) }
				aria-label={ __( 'Open in browser' ) }
			>
				<Icon icon={ external } size={ 18 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Close preview' ) }
				onClick={ () => onUpdatePreviewState( { ...previewState, open: false } ) }
				aria-label={ __( 'Close preview' ) }
			>
				<Icon icon={ closeSmall } size={ 20 } />
			</Button>
		</div>
	);
}

export function WorkspacePreviewPanel( {
	siteName,
	previewUrl,
	reloadNonce,
	width,
	navigationAction,
	navigationActionId,
	onResize,
	onNavigationStateChange,
}: WorkspacePreviewPanelProps ) {
	const [ isResizing, setIsResizing ] = useState( false );
	const panelRef = useRef< HTMLElement >( null );
	const webviewRef = useRef< WorkspacePreviewWebview >( null );
	const isWebviewReady = useRef( false );
	const handledNavigationActionId = useRef( 0 );
	const panelWidth = clampPreviewWidth( width );

	const updateNavigationState = useCallback( () => {
		const webview = webviewRef.current;
		if ( ! webview || ! isWebviewReady.current ) {
			onNavigationStateChange( {
				canGoBack: false,
				canGoForward: false,
				currentUrl: previewUrl,
			} );
			return;
		}

		try {
			onNavigationStateChange( {
				canGoBack: webview.canGoBack?.() ?? false,
				canGoForward: webview.canGoForward?.() ?? false,
				currentUrl: webview.getURL?.() || previewUrl,
			} );
		} catch {
			onNavigationStateChange( {
				canGoBack: false,
				canGoForward: false,
				currentUrl: previewUrl,
			} );
		}
	}, [ onNavigationStateChange, previewUrl ] );

	const handleMouseMove = useCallback(
		( event: MouseEvent ) => {
			const panelRight = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
			const nextWidth = panelRight - event.clientX;
			onResize( clampPreviewWidth( nextWidth ) );
		},
		[ onResize ]
	);

	const stopResizing = useCallback( () => {
		setIsResizing( false );
	}, [] );

	useEffect( () => {
		if ( ! isResizing ) {
			return;
		}

		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener( 'mousemove', handleMouseMove );
		window.addEventListener( 'mouseup', stopResizing );

		return () => {
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener( 'mousemove', handleMouseMove );
			window.removeEventListener( 'mouseup', stopResizing );
		};
	}, [ handleMouseMove, isResizing, stopResizing ] );

	const resizeBy = ( delta: number ) => {
		onResize( clampPreviewWidth( panelWidth + delta ) );
	};

	useEffect( () => {
		if ( ! navigationAction || navigationActionId === handledNavigationActionId.current ) {
			return;
		}

		const webview = webviewRef.current;
		if ( webview && isWebviewReady.current ) {
			try {
				if ( navigationAction === 'back' && webview.canGoBack?.() ) {
					webview.goBack?.();
				}
				if ( navigationAction === 'forward' && webview.canGoForward?.() ) {
					webview.goForward?.();
				}
			} catch {
				updateNavigationState();
			}
		}
		handledNavigationActionId.current = navigationActionId;
	}, [ navigationAction, navigationActionId, updateNavigationState ] );

	useEffect( () => {
		const webview = webviewRef.current;
		if ( ! webview ) {
			return;
		}

		isWebviewReady.current = false;
		const updateState = () => updateNavigationState();
		const handleDomReady = () => {
			isWebviewReady.current = true;
			updateNavigationState();
		};
		const events = [ 'did-finish-load', 'did-navigate', 'did-navigate-in-page' ];
		webview.addEventListener( 'dom-ready', handleDomReady );
		events.forEach( ( eventName ) => webview.addEventListener( eventName, updateState ) );
		updateNavigationState();

		return () => {
			isWebviewReady.current = false;
			webview.removeEventListener( 'dom-ready', handleDomReady );
			events.forEach( ( eventName ) => webview.removeEventListener( eventName, updateState ) );
		};
	}, [ reloadNonce, updateNavigationState ] );

	return (
		<aside
			ref={ panelRef }
			className="relative mt-10 flex shrink-0 flex-col border-l border-a8c-gray-5 bg-white"
			aria-label={ __( 'Workspace site preview' ) }
			style={ {
				width: panelWidth,
				height: `calc(100% - ${ PREVIEW_TOP_OFFSET }px)`,
			} }
		>
			<button
				type="button"
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				aria-label={ __( 'Resize preview' ) }
				aria-orientation="vertical"
				aria-valuemin={ MIN_PREVIEW_WIDTH }
				aria-valuemax={ MAX_PREVIEW_WIDTH }
				aria-valuenow={ panelWidth }
				role="separator"
				onMouseDown={ ( event ) => {
					event.preventDefault();
					setIsResizing( true );
				} }
				onKeyDown={ ( event ) => {
					if ( event.key === 'ArrowLeft' ) {
						event.preventDefault();
						resizeBy( 32 );
					}
					if ( event.key === 'ArrowRight' ) {
						event.preventDefault();
						resizeBy( -32 );
					}
				} }
			/>
			<div className="relative min-h-0 flex-1 bg-a8c-gray-0">
				{ previewUrl ? (
					<webview
						ref={ webviewRef }
						key={ `${ previewUrl }#${ reloadNonce }` }
						className="absolute inset-0 h-full w-full border-0 bg-white"
						src={ previewUrl }
						title={ `${ siteName } preview` }
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
						<Icon icon={ desktop } size={ 32 } className="fill-frame-text-secondary" />
						<div className="text-sm font-medium text-frame-text">
							{ __( 'Preview unavailable' ) }
						</div>
					</div>
				) }
			</div>
		</aside>
	);
}
