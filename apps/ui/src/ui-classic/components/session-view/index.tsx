import { resolveSessionModel } from '@studio/common/ai/models';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { arrowDown } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type Ref,
} from 'react';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import {
	useCreateSession,
	useSession,
	useSessionEffectiveEnvironment,
	useSessions,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewAnnotations } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import { getSiteSessionHistory, SessionChatActions } from './session-chat-actions';
import styles from './style.module.css';
import { SuggestedPrompts } from './suggested-prompts';
import type { AiSessionSummary } from '@/data/core';

// Slack below the bottom edge that still counts as "at the latest message",
// so sub-pixel rounding or a barely-started scroll doesn't flash the button.
const SCROLL_AWAY_FROM_LATEST_THRESHOLD_PX = 48;

export function isScrolledAwayFromLatest( node: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
} ): boolean {
	return (
		node.scrollHeight - node.scrollTop - node.clientHeight > SCROLL_AWAY_FROM_LATEST_THRESHOLD_PX
	);
}

interface SessionHeaderProps {
	summary: AiSessionSummary;
}

function SessionHeader( { summary }: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const { data: sites } = useSites();
	const site = findAiSessionOwnerSite( sites, summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	if ( ! siteName ) {
		return null;
	}

	return (
		<div
			className={ clsx(
				styles.header,
				sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
			) }
		>
			{ site ? (
				<SiteDropdown
					site={ site }
					activeEnvironment={ effectiveEnvironment }
					showSiteIcon
					showStatus={ sidebarCollapsed }
				/>
			) : (
				<>
					<SiteIcon className={ styles.headerSiteIcon } seed={ siteName } />
					<span className={ styles.headerSite }>{ siteName }</span>
					<span className={ styles.headerDot } aria-hidden="true" />
					<span className={ styles.headerEnv }>
						{ effectiveEnvironment === 'live' ? __( 'Live' ) : __( 'Local' ) }
					</span>
				</>
			) }
			<span className={ styles.headerSpacer } aria-hidden="true" />
		</div>
	);
}

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	footer?: ReactNode;
	footerEnd?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
function SessionFrame( {
	header,
	composer,
	footer,
	footerEnd,
	scrollRef,
	children,
}: SessionFrameProps ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );
	const sidebarCollapsed = useSidebarCollapsed();

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		const updateChromeSize = () => {
			root.style.setProperty(
				'--classic-header-height',
				`${ headerRef.current?.offsetHeight ?? 0 }px`
			);
			root.style.setProperty(
				'--classic-composer-height',
				`${ composerRef.current?.offsetHeight ?? 0 }px`
			);
		};

		updateChromeSize();

		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateChromeSize );
			return () => window.removeEventListener( 'resize', updateChromeSize );
		}

		const resizeObserver = new ResizeObserver( updateChromeSize );
		if ( headerRef.current ) {
			resizeObserver.observe( headerRef.current );
		}
		if ( composerRef.current ) {
			resizeObserver.observe( composerRef.current );
		}

		return () => resizeObserver.disconnect();
	}, [] );

	return (
		<div ref={ rootRef } className={ clsx( styles.root, footer && styles.rootWithFooter ) }>
			<div ref={ headerRef } className={ styles.headerLayer }>
				{ header }
			</div>
			<div ref={ scrollRef } className={ clsx( styles.scroll, styles.classicScroll ) }>
				{ children }
			</div>
			<ProgressiveBlur direction="down" className={ styles.headerBlur } fadeToSurface />
			<ProgressiveBlur direction="up" className={ styles.composerBlur } />
			<div
				ref={ composerRef }
				className={ clsx( styles.composerOuter, styles.classicComposerOuter ) }
			>
				{ composer }
			</div>
			{ footer ? (
				<div
					className={ clsx(
						styles.panelFooterControls,
						sidebarCollapsed && styles.panelFooterControlsCollapsed
					) }
				>
					{ footer }
				</div>
			) : null }
			{ footerEnd ? (
				<div className={ clsx( styles.panelFooterControls, styles.panelFooterControlsEnd ) }>
					{ footerEnd }
				</div>
			) : null }
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
	const { data: sessions } = useSessions();
	const { mutateAsync: createSession, isPending: isCreatingSession } = useCreateSession();
	const ownerSite = findAiSessionOwnerSite( sites, data?.summary );
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
	const composerRef = useRef< ComposerHandle >( null );
	const [ isScrolledAway, setIsScrolledAway ] = useState( false );
	const hasSession = !! data;

	const updateIsScrolledAway = useCallback( () => {
		const node = scrollRef.current;
		if ( node ) {
			setIsScrolledAway( isScrolledAwayFromLatest( node ) );
		}
	}, [] );

	useEffect( () => {
		const node = scrollRef.current;
		if ( ! hasSession || ! node ) {
			return;
		}
		updateIsScrolledAway();
		node.addEventListener( 'scroll', updateIsScrolledAway, { passive: true } );
		return () => node.removeEventListener( 'scroll', updateIsScrolledAway );
	}, [ hasSession, updateIsScrolledAway ] );

	// Content can grow without emitting scroll events (e.g. while the
	// auto-scroll below is suspended by pending questions), so re-check
	// whenever the transcript changes.
	useEffect( () => {
		updateIsScrolledAway();
	}, [ data, pendingQuestions.length, queuedPrompts.length, updateIsScrolledAway ] );

	const scrollToLatest = useCallback( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		node.scrollTo( { top: node.scrollHeight, behavior: prefersReducedMotion ? 'auto' : 'smooth' } );
	}, [] );
	useSessionCommands( sessionId );
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const siteSessionHistory = data
		? getSiteSessionHistory( {
				currentSession: data.summary,
				ownerSite,
				sessions,
		  } )
		: [];
	const archivedSiteSessionHistory = data
		? getSiteSessionHistory( {
				currentSession: data.summary,
				ownerSite,
				sessions,
				archived: true,
		  } )
		: [];

	const handleAnnotationsDone = useCallback(
		( annotations: Annotation[] ) => {
			if ( annotations.length === 0 ) return;
			void sendMessage( formatAnnotationsAsPrompt( annotations ), {
				displayMessage: formatAnnotationsSubmittedMessage( annotations.length ),
			} );
		},
		[ sendMessage ]
	);
	// The preview panel itself is hosted by the dashboard layout; route its
	// annotation submissions to this session while it is on screen.
	useSessionPreviewAnnotations( handleAnnotationsDone, canTogglePreview );

	const reopenQueuedPrompt = useCallback(
		( queuedPrompt: ( typeof queuedPrompts )[ number ] ) => {
			removeQueuedPrompt( queuedPrompt.id );
			composerRef.current?.replaceDraft( queuedPrompt.prompt, {
				images: queuedPrompt.images,
				files: queuedPrompt.files,
			} );
		},
		[ removeQueuedPrompt ]
	);
	const switchSession = useCallback(
		( nextSessionId: string ) =>
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: nextSessionId },
			} ),
		[ navigate ]
	);
	const startNewChat = useCallback( async () => {
		// Already on a chat with no prompts yet — creating another empty
		// session would just flash the view for an identical result.
		if ( ! ownerSite || isEmpty ) {
			return;
		}
		try {
			const summary = await createSession( ownerSite.id );
			switchSession( summary.id );
		} catch {
			// The mutation owns the error state; avoid an unhandled rejection
			// from this command button if session creation fails.
		}
	}, [ createSession, isEmpty, ownerSite, switchSession ] );

	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node || pendingQuestions.length > 0 ) {
			return;
		}
		node.scrollTop = node.scrollHeight;
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data, isRunning, pendingQuestions.length, queuedPrompts.length ] );

	// The open session can vanish out from under this view — most commonly when
	// its site is deleted, which removes the transcript from disk. Bounce to the
	// root (the next available site) rather than flashing the dead-end "Session
	// not found" screen; the skeleton below covers the brief redirect.
	const notFound = ! isLoading && ( !! error || ! data );
	useEffect( () => {
		if ( notFound ) {
			void navigate( { to: '/' } );
		}
	}, [ notFound, navigate ] );

	if ( isLoading || notFound || ! data ) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the EmptyBackground canvas jumps
		// mid-transition.
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ clsx( styles.classicColumn, styles.classicComposerColumn ) }>
						<ComposerSkeleton />
					</div>
				}
				footer={ <div aria-hidden /> }
			>
				<EmptyBackground />
			</SessionFrame>
		);
	}

	return (
		<SessionFrame
			scrollRef={ scrollRef }
			header={ <SessionHeader summary={ data.summary } /> }
			composer={
				<div className={ clsx( styles.classicColumn, styles.classicComposerColumn ) }>
					{ isScrolledAway ? (
						<div className={ styles.scrollToLatestWrap }>
							<IconButton
								className={ styles.scrollToLatestButton }
								icon={ arrowDown }
								label={ __( 'Scroll to latest message' ) }
								size="small"
								variant="minimal"
								tone="neutral"
								onClick={ scrollToLatest }
							/>
						</div>
					) : null }
					<QueuedPrompts
						prompts={ queuedPrompts }
						onRemove={ removeQueuedPrompt }
						onEdit={ reopenQueuedPrompt }
					/>
					<Composer
						ref={ composerRef }
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						error={ runError }
						model={ currentModel }
						onSend={ sendMessage }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ switchSession }
					/>
				</div>
			}
			footer={
				ownerSite ? (
					<SessionChatActions
						archivedSessions={ archivedSiteSessionHistory }
						currentSessionId={ sessionId }
						isCreatingSession={ isCreatingSession }
						onNewChat={ startNewChat }
						onSwitchSession={ switchSession }
						sessions={ siteSessionHistory }
					/>
				) : null
			}
			footerEnd={ canTogglePreview ? <PreviewToggleButton /> : null }
		>
			{ isEmpty ? <EmptyBackground /> : null }
			{ isEmpty && ownerSite ? (
				<SuggestedPrompts
					siteName={ ownerSite.name }
					onPick={ ( prompt ) => composerRef.current?.replaceDraft( prompt ) }
					hasExistingDraft={ () => composerRef.current?.hasDraft() ?? false }
				/>
			) : null }
			<div
				className={ clsx(
					styles.classicColumn,
					styles.classicConversationSpacing,
					pendingQuestions.length > 0 && styles.classicConversationWithQuestions
				) }
			>
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
