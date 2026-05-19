import { __ } from '@wordpress/i18n';
import {
	chevronLeft,
	chevronRight,
	closeSmall,
	desktop,
	external,
	Icon,
	rotateRight,
} from '@wordpress/icons';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { WorkspaceTargetId } from 'src/modules/workspaces/types';

const DEFAULT_PREVIEW_WIDTH = 520;
const MIN_PREVIEW_WIDTH = 360;
const MAX_PREVIEW_WIDTH = 920;
const PREVIEW_TOP_OFFSET = 48;

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
	label?: string;
	isProduction?: boolean;
	isLoading?: boolean;
	onShowPreview?: () => Promise< void > | void;
};

export type WorkspacePreviewTargetOption = {
	id: WorkspaceTargetId;
	label: string;
	isProduction?: boolean;
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

type WorkspacePreviewTargetPickerProps = {
	targets: WorkspacePreviewTargetOption[];
	selectedTargetId: WorkspaceTargetId;
	onSelectTarget: ( targetId: WorkspaceTargetId ) => void;
	ariaLabel: string;
	variant?: 'url-bar' | 'header';
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

function getTargetToneClassName( target: WorkspacePreviewTargetOption | undefined ) {
	if ( target?.id === 'production' || target?.isProduction ) {
		return {
			dot: 'bg-[#1a6928]',
			url: 'bg-[#ceead6] text-[#1a6928]',
			header: 'border-[#9bd3a8] bg-[#ceead6] text-[#1a6928] hover:bg-[#c3e4cc]',
		};
	}

	if ( target?.id === 'staging' ) {
		return {
			dot: 'bg-[#d97706]',
			url: 'bg-[#fef0c7] text-[#93590c]',
			header: 'border-[#d97706]/30 bg-[#fff7df] text-[#93590c] hover:bg-[#fff3cc]',
		};
	}

	return {
		dot: 'bg-frame-text-secondary',
		url: 'bg-frame-surface text-frame-text-secondary',
		header: 'border-a8c-gray-5 bg-frame-surface text-frame-text-secondary hover:bg-a8c-gray-0',
	};
}

export function WorkspacePreviewTargetPicker( {
	targets,
	selectedTargetId,
	onSelectTarget,
	ariaLabel,
	variant = 'url-bar',
}: WorkspacePreviewTargetPickerProps ) {
	const selectedTarget = targets.find( ( candidate ) => candidate.id === selectedTargetId );
	const hasTargetPicker = targets.length > 1;
	const [ isTargetMenuOpen, setIsTargetMenuOpen ] = useState( false );
	const toneClassName = getTargetToneClassName( selectedTarget );
	const isHeaderVariant = variant === 'header';
	const closeTargetMenu = () => setIsTargetMenuOpen( false );
	const selectTarget = ( targetId: WorkspaceTargetId ) => {
		onSelectTarget( targetId );
		closeTargetMenu();
	};
	const basePickerClassName = isHeaderVariant
		? `inline-flex h-10 min-w-40 items-center gap-2 rounded border px-3 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme ${ toneClassName.header }`
		: `inline-flex h-8 min-w-32 items-center justify-center rounded-full px-3 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme ${ toneClassName.url }`;
	const pickerContent = (
		<>
			{ isHeaderVariant && (
				<>
					<span className={ `h-2.5 w-2.5 rounded-full ${ toneClassName.dot }` } />
					<span className="text-frame-text-secondary">{ __( 'Viewing' ) }</span>
				</>
			) }
			<span>{ selectedTarget?.label }</span>
			{ hasTargetPicker && <span className="ms-1 text-[10px] leading-none">⌄</span> }
		</>
	);

	if ( ! selectedTarget?.label ) {
		return null;
	}

	return (
		<div
			className={ isHeaderVariant ? 'relative shrink-0' : 'relative shrink-0' }
			onBlur={ ( event ) => {
				if ( ! event.currentTarget.contains( event.relatedTarget ) ) {
					closeTargetMenu();
				}
			} }
		>
			{ hasTargetPicker ? (
				<button
					type="button"
					className={ basePickerClassName }
					aria-label={ ariaLabel }
					aria-haspopup="listbox"
					aria-expanded={ isTargetMenuOpen }
					onClick={ () => setIsTargetMenuOpen( ( isOpen ) => ! isOpen ) }
				>
					{ pickerContent }
				</button>
			) : (
				<span className={ basePickerClassName }>{ pickerContent }</span>
			) }
			{ hasTargetPicker && isTargetMenuOpen && (
				<div
					className={
						isHeaderVariant
							? 'absolute right-0 top-11 z-30 min-w-48 rounded-md border border-a8c-gray-5 bg-white p-1 shadow-lg'
							: 'absolute left-0 top-11 z-20 min-w-40 rounded-md border border-a8c-gray-5 bg-white p-1 shadow-lg'
					}
					role="listbox"
					aria-label={ ariaLabel }
				>
					{ targets.map( ( candidate ) => (
						<button
							key={ candidate.id }
							type="button"
							className={ `flex h-8 w-full items-center justify-between rounded px-3 text-left text-xs hover:bg-a8c-gray-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme ${
								candidate.id === selectedTargetId
									? 'font-medium text-frame-text'
									: 'text-frame-text-secondary'
							}` }
							role="option"
							aria-selected={ candidate.id === selectedTargetId }
							onClick={ () => selectTarget( candidate.id ) }
						>
							<span>{ candidate.label }</span>
						</button>
					) ) }
				</div>
			) }
		</div>
	);
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
			<div className="relative min-w-0 flex-1">
				<div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-2 text-left shadow-sm transition hover:border-a8c-gray-20 hover:bg-white">
					<button
						type="button"
						className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme disabled:cursor-default disabled:opacity-60"
						onClick={ showPreview }
						aria-label={ __( 'Show preview' ) }
						disabled={ target.isLoading }
					>
						<span className="min-w-0 flex-1 truncate text-xs leading-4 text-frame-text-secondary">
							{ displayUrl }
						</span>
						<Icon icon={ desktop } size={ 18 } className="shrink-0 fill-frame-text-secondary" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-10 w-full min-w-0 items-center justify-end gap-1.5">
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
			<div className="relative min-w-0 flex-1">
				<div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-2 text-left shadow-sm">
					<span className="truncate px-3 text-xs leading-4 text-frame-text-secondary">
						{ displayUrl }
					</span>
				</div>
			</div>
			<Button
				variant="icon"
				tooltipText={ __( 'Open in browser' ) }
				onClick={ () => getIpcApi().openURL( displayUrl ) }
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

	const resizeToClientX = useCallback(
		( clientX: number ) => {
			const panelRight = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
			const nextWidth = panelRight - clientX;
			onResize( clampPreviewWidth( nextWidth ) );
		},
		[ onResize ]
	);

	const handleMouseMove = useCallback(
		( event: MouseEvent ) => {
			resizeToClientX( event.clientX );
		},
		[ resizeToClientX ]
	);

	const startResizing = useCallback(
		( event: ReactMouseEvent< HTMLElement > ) => {
			event.preventDefault();
			resizeToClientX( event.clientX );
			setIsResizing( true );
		},
		[ resizeToClientX ]
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
		window.addEventListener( 'blur', stopResizing );

		return () => {
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener( 'mousemove', handleMouseMove );
			window.removeEventListener( 'mouseup', stopResizing );
			window.removeEventListener( 'blur', stopResizing );
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
			className="relative mt-12 flex shrink-0 flex-col border-l border-a8c-gray-5 bg-white"
			aria-label={ __( 'Workspace site preview' ) }
			style={ {
				width: panelWidth,
				height: `calc(100% - ${ PREVIEW_TOP_OFFSET }px)`,
			} }
		>
			{ isResizing && (
				<div
					data-testid="workspace-preview-resize-overlay"
					className="fixed inset-0 z-50 cursor-col-resize"
					aria-hidden="true"
					onMouseMove={ ( event ) => resizeToClientX( event.clientX ) }
					onMouseUp={ stopResizing }
					onMouseLeave={ stopResizing }
				/>
			) }
			<div
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				aria-label={ __( 'Resize preview' ) }
				aria-orientation="vertical"
				aria-valuemin={ MIN_PREVIEW_WIDTH }
				aria-valuemax={ MAX_PREVIEW_WIDTH }
				aria-valuenow={ panelWidth }
				role="separator"
				tabIndex={ 0 }
				onMouseDown={ startResizing }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Escape' ) {
						event.preventDefault();
						stopResizing();
					}
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
