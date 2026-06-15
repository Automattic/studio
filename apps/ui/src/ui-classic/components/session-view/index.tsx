import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
	type Ref,
} from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { SitePreview } from '@/components/site-preview';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import { PREVIEW_PANEL_CONFIG, PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton } from './composer';
import { pickLiveSite } from './composer/environment-pill';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

// Keep in sync with the flex-basis transition duration in style.module.css.
const PREVIEW_TOGGLE_DURATION = 150;

interface SessionHeaderProps {
	summary: AiSessionSummary;
	previewOpen: boolean;
	onTogglePreview: () => void;
	canTogglePreview: boolean;
}

function SessionHeader( {
	summary,
	previewOpen,
	onTogglePreview,
	canTogglePreview,
}: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	if ( ! siteName ) {
		return null;
	}

	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;

	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
			{ site ? (
				<SiteDropdown
					site={ site }
					activeEnvironment={ effectiveEnvironment }
					showSiteIcon={ sidebarCollapsed }
				/>
			) : (
				<>
					{ sidebarCollapsed ? (
						<SiteIcon className={ styles.headerSiteIcon } seed={ siteName } />
					) : null }
					<span className={ styles.headerSite }>{ siteName }</span>
					<span className={ styles.headerDot } aria-hidden="true" />
					<span className={ styles.headerEnv }>
						{ effectiveEnvironment === 'live' ? __( 'Live' ) : __( 'Local' ) }
					</span>
				</>
			) }
			<span className={ styles.headerSpacer } aria-hidden="true" />
			{ canTogglePreview ? (
				<div className={ styles.headerActions }>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ drawerIcon }
						label={ previewOpen ? __( 'Hide site preview' ) : __( 'Show site preview' ) }
						aria-pressed={ previewOpen }
						onClick={ onTogglePreview }
					/>
				</div>
			) : null }
		</div>
	);
}

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	// The preview panel content. Kept mounted (hidden behind the chat column)
	// while `previewOpen` is false so the webview stays warm and the panel can
	// slide in and out.
	preview?: ReactNode;
	previewOpen?: boolean;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

// Splits the session screen between the chat column and the site preview. The
// preview slot is pinned to the right edge at its resizable width; the chat
// column sits on top of it and shrinks to reveal it, so toggling animates by
// transitioning only the chat column's flex-basis while the preview keeps a
// constant width (no mid-animation webview reflow).
function SessionFrame( {
	header,
	composer,
	preview,
	previewOpen = false,
	scrollRef,
	children,
}: SessionFrameProps ) {
	const previewMounted = preview != null;
	const showPreview = previewMounted && previewOpen;
	const previewResize = useResizablePanel( {
		config: PREVIEW_PANEL_CONFIG,
		edge: 'left',
		storageKey: PREVIEW_PANEL_STORAGE_KEY,
	} );
	// Animate only open/close toggles of an already-mounted preview — never
	// the initial layout, so a session loading with the preview visible
	// doesn't replay the slide-in. The render-phase update makes the
	// transition class land in the same commit as the flex-basis change; an
	// effect-based update would race it.
	const [ animating, setAnimating ] = useState( false );
	const [ previousPreview, setPreviousPreview ] = useState( {
		mounted: previewMounted,
		open: showPreview,
	} );
	if ( previousPreview.mounted !== previewMounted || previousPreview.open !== showPreview ) {
		setPreviousPreview( { mounted: previewMounted, open: showPreview } );
		if ( previousPreview.mounted && previewMounted ) {
			setAnimating( true );
		}
	}
	useEffect( () => {
		if ( ! animating ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setAnimating( false ), PREVIEW_TOGGLE_DURATION );
		return () => window.clearTimeout( timeoutId );
	}, [ animating, showPreview ] );

	const rootStyle = { '--site-preview-width': `${ previewResize.width }px` } as CSSProperties;

	return (
		<div
			className={ clsx(
				styles.root,
				showPreview && styles.rootPreviewOpen,
				animating && styles.rootPreviewAnimating
			) }
			style={ rootStyle }
		>
			<div className={ styles.chatColumn }>
				{ header }
				<div ref={ scrollRef } className={ clsx( styles.scroll, styles.classicScroll ) }>
					{ children }
				</div>
				<div className={ clsx( styles.composerOuter, styles.classicComposerOuter ) }>
					{ composer }
				</div>
			</div>
			{ preview != null ? (
				<div className={ clsx( styles.previewSlot, showPreview && styles.previewSlotOpen ) }>
					{ preview }
				</div>
			) : null }
			{ showPreview && ! animating ? (
				<ResizeHandle
					className={ styles.previewResizeHandle }
					label={ __( 'Resize site preview' ) }
					minWidth={ previewResize.minWidth }
					maxWidth={ previewResize.maxWidth }
					width={ previewResize.width }
					isResizing={ previewResize.isResizing }
					onResizeStart={ previewResize.handleResizeStart }
					onKeyDown={ previewResize.handleKeyDown }
				/>
			) : null }
			{ previewResize.isResizing ? <ResizeOverlay /> : null }
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	return (
		<SessionUIProvider>
			<SessionViewContent sessionId={ sessionId } />
		</SessionUIProvider>
	);
}

function SessionViewContent( { sessionId }: { sessionId: string } ) {
	const navigate = useNavigate();
	const { data, isLoading, error } = useSession( sessionId );
	const { data: sites } = useSites();
	const ownerSitePath = data?.summary.ownerSitePath;
	const ownerSite = ownerSitePath
		? sites?.find( ( candidate ) => candidate.path === ownerSitePath )
		: undefined;
	const { data: connectedSites } = useConnectedWpcomSites( ownerSite?.id );
	const liveSite = pickLiveSite( connectedSites );
	const effectiveEnvironment = useSessionEffectiveEnvironment( data?.summary, ownerSite?.id );
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
		error: runError,
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		removeQueuedPrompt,
	} = useAgentRun( sessionId );
	const currentModel = useMemo(
		() => resolveSessionModel( data?.entries ?? [] ),
		[ data?.entries ]
	);
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	const isEmpty = useMemo(
		() =>
			! ( data?.entries ?? [] ).some(
				( entry ) => entry.type === 'custom' && entry.customType === 'studio.user_prompt'
			),
		[ data?.entries ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	useSessionCommands( sessionId );
	const preview = useSessionPreviewUI();
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const showPreview = preview.open && canTogglePreview;

	const handleAnnotationsDone = useCallback(
		( annotations: Annotation[] ) => {
			if ( annotations.length === 0 ) return;
			void sendMessage( formatAnnotationsAsPrompt( annotations ), {
				displayMessage: formatAnnotationsSubmittedMessage( annotations.length ),
			} );
		},
		[ sendMessage ]
	);

	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		node.scrollTop = node.scrollHeight;
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data, isRunning, queuedPrompts.length ] );

	if ( isLoading ) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the EmptyBackground canvas jumps
		// mid-transition.
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ styles.classicColumn }>
						<ComposerSkeleton />
					</div>
				}
			>
				<EmptyBackground />
			</SessionFrame>
		);
	}

	if ( error || ! data ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Session not found' ) }</h1>
				<p>{ sessionId }</p>
			</div>
		);
	}

	return (
		<SessionFrame
			scrollRef={ scrollRef }
			header={
				<SessionHeader
					summary={ data.summary }
					previewOpen={ showPreview }
					onTogglePreview={ preview.toggle }
					canTogglePreview={ canTogglePreview }
				/>
			}
			composer={
				<div className={ styles.classicColumn }>
					<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
					<Composer
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onSend={ sendMessage }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						effectiveEnvironment={ effectiveEnvironment }
						liveSite={ liveSite }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ ( nextSessionId ) =>
							void navigate( {
								to: '/sessions/$sessionId',
								params: { sessionId: nextSessionId },
							} )
						}
					/>
				</div>
			}
			previewOpen={ showPreview }
			preview={
				canTogglePreview && ownerSite ? (
					<SitePreview
						site={ ownerSite }
						path={ preview.path }
						reloadNonce={ preview.reloadNonce }
						onAnnotationsDone={ handleAnnotationsDone }
						onPathChange={ preview.updatePath }
						collapsed={ ! showPreview }
					/>
				) : null
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div className={ clsx( styles.classicColumn, styles.classicConversationSpacing ) }>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
		</SessionFrame>
	);
}
