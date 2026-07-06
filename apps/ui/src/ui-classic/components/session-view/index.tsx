import { resolveSessionModel } from '@studio/common/ai/models';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
	type ReactNode,
	type Ref,
} from 'react';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteHeaderActions } from '@/components/site-header-actions';
import { SiteIcon } from '@/components/site-icon';
import {
	appendPreviewConsoleEntriesToPrompt,
	stripPreviewConsolePromptBlock,
} from '@/components/site-preview/console-utils';
import { type Annotation, type PreviewConsoleTextFile } from '@/components/site-preview/types';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAgentRun } from '@/data/queries/use-agent-run';
import {
	useCreateSession,
	useSession,
	useSessionEffectiveEnvironment,
	useSessions,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSessionCommands } from '@/hooks/use-session-commands';
import {
	SessionUIProvider,
	useSessionPreviewAnnotations,
	useSessionPreviewConsoleFile,
	useSessionPreviewConsoleEntries,
	useSessionPreviewScreenshot,
} from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { pendingSessionPromptSlot, type PendingSessionPrompt } from '@/lib/pending-session-prompt';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import { ScrollToBottomButton } from './scroll-to-bottom-button';
import {
	getSiteArchivedSessionHistory,
	getSiteSessionHistory,
	SessionChatActions,
	SessionChatActionsSkeleton,
} from './session-chat-actions';
import styles from './style.module.css';
import { useStickToBottom } from './use-stick-to-bottom';
import type { AiSessionSummary, PermissionDecision } from '@/data/core';

interface SessionHeaderProps {
	summary: AiSessionSummary;
}

function SessionHeader( { summary }: SessionHeaderProps ) {
	const siteName = summary.ownerSiteName;
	const sidebarCollapsed = useSidebarCollapsed();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.path === summary.ownerSitePath );
	const effectiveEnvironment = useSessionEffectiveEnvironment( summary, site?.id );
	if ( ! siteName ) {
		return null;
	}

	return (
		<div className={ clsx( styles.header, sidebarCollapsed && styles.headerSidebarCollapsed ) }>
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
			{ site ? <SiteHeaderActions site={ site } /> : null }
		</div>
	);
}

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	composerOverlay?: ReactNode;
	footer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
function SessionFrame( {
	header,
	composer,
	composerOverlay,
	footer,
	scrollRef,
	children,
}: SessionFrameProps ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		// The dashboard's floating toast shelf reads the composer height off
		// the main panel to position itself above the composer while a chat
		// session is on screen.
		const mainPanel = root.closest< HTMLElement >( '[data-app-main]' );

		const updateChromeSize = () => {
			const composerHeight = composerRef.current?.offsetHeight ?? 0;
			root.style.setProperty(
				'--classic-header-height',
				`${ headerRef.current?.offsetHeight ?? 0 }px`
			);
			root.style.setProperty( '--classic-composer-height', `${ composerHeight }px` );
			mainPanel?.style.setProperty( '--app-main-composer-height', `${ composerHeight }px` );
		};

		updateChromeSize();

		const clearMainPanelProperty = () =>
			mainPanel?.style.removeProperty( '--app-main-composer-height' );

		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateChromeSize );
			return () => {
				window.removeEventListener( 'resize', updateChromeSize );
				clearMainPanelProperty();
			};
		}

		const resizeObserver = new ResizeObserver( updateChromeSize );
		if ( headerRef.current ) {
			resizeObserver.observe( headerRef.current );
		}
		if ( composerRef.current ) {
			resizeObserver.observe( composerRef.current );
		}

		return () => {
			resizeObserver.disconnect();
			clearMainPanelProperty();
		};
	}, [] );

	return (
		<div
			ref={ rootRef }
			className={ clsx( styles.root, footer && styles.rootWithFooter ) }
			data-classic-session-view
		>
			<div ref={ headerRef } className={ styles.headerLayer }>
				{ header }
			</div>
			<div ref={ scrollRef } className={ clsx( styles.scroll, styles.classicScroll ) }>
				{ children }
			</div>
			<ProgressiveBlur direction="down" className={ styles.headerBlur } fadeToSurface />
			<ProgressiveBlur direction="up" className={ styles.composerBlur } />
			{ composerOverlay ? (
				<div className={ styles.composerOverlay }>{ composerOverlay }</div>
			) : null }
			<div
				ref={ composerRef }
				className={ clsx( styles.composerOuter, styles.classicComposerOuter ) }
			>
				{ composer }
			</div>
			{ footer ? <div className={ styles.panelFooterControls }>{ footer }</div> : null }
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
	const connector = useConnector();
	const { data, isLoading, isFetching, error } = useSession( sessionId );
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const { mutateAsync: createSession, isPending: isCreatingSession } = useCreateSession();
	const ownerSitePath = data?.summary.ownerSitePath;
	const ownerSite = ownerSitePath
		? sites?.find( ( candidate ) => candidate.path === ownerSitePath )
		: undefined;
	const effectiveEnvironment = useSessionEffectiveEnvironment( data?.summary, ownerSite?.id );
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
		error: runError,
		pendingQuestions,
		pendingPermissions,
		answeredPermissions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		answerPermission,
		removeQueuedPrompt,
	} = useAgentRun( sessionId );
	// Sessions with no recorded model (fresh chats) start on the user's
	// preferred default model rather than the built-in default.
	const { data: preferences } = useUserPreferences();
	const currentModel = useMemo(
		() => resolveSessionModel( data?.entries ?? [], preferences?.defaultAiModel ),
		[ data?.entries, preferences?.defaultAiModel ]
	);
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const pendingPermissionIds = useMemo(
		() => new Set( pendingPermissions.map( ( request ) => request.id ) ),
		[ pendingPermissions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0 || pendingPermissions.length > 0;

	// Run failures (send rejected, agent unavailable, run crashed) surface as
	// app toasts rather than a dedicated row under the composer. The effect
	// fires once per distinct error; a new run clears the state so the next
	// failure announces again.
	useEffect( () => {
		if ( runError ) {
			toast.error( runError );
		}
	}, [ runError ] );
	const isEmpty = useMemo(
		() =>
			! ( data?.entries ?? [] ).some(
				( entry ) => entry.type === 'custom' && entry.customType === 'studio.user_prompt'
			),
		[ data?.entries ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< ComposerHandle >( null );
	// The pending permission card holds keyboard focus; hand it back to the
	// composer once the user decides (the card collapses to a static row).
	const answerPermissionAndRefocus = useCallback(
		( requestId: string, decision: PermissionDecision ) => {
			answerPermission( requestId, decision );
			composerRef.current?.focus();
		},
		[ answerPermission ]
	);
	const { isAtBottom, isAtBottomRef, scrollToBottom } = useStickToBottom( scrollRef, sessionId );
	useSessionCommands( sessionId );
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const previewConsoleEntries = useSessionPreviewConsoleEntries();
	const sendMessageWithConsole = useCallback(
		async ( prompt: string, options?: Parameters< typeof sendMessage >[ 1 ] ) => {
			const nextPrompt =
				canTogglePreview && previewConsoleEntries.length > 0
					? appendPreviewConsoleEntriesToPrompt( prompt, previewConsoleEntries )
					: prompt;
			await sendMessage( nextPrompt, {
				...options,
				displayMessage: options?.displayMessage ?? ( nextPrompt === prompt ? undefined : prompt ),
			} );
		},
		[ canTogglePreview, previewConsoleEntries, sendMessage ]
	);
	// A flow can queue a prompt to auto-send in this site's next session
	// (e.g. plugin creation handing the description to the agent). The sent
	// ref guards StrictMode's double-invoked effects from sending twice.
	// Waits for the session query to settle: the new-session route primes the
	// cache and fires a reconciling refetch, and sending while that fetch is
	// in flight lets it resolve afterwards with the still-empty on-disk
	// session — clobbering the optimistic user-prompt entry.
	const pendingPrompt = useSyncExternalStore(
		pendingSessionPromptSlot.subscribe,
		pendingSessionPromptSlot.peek
	);
	const sentPendingPromptRef = useRef< PendingSessionPrompt | null >( null );
	useEffect( () => {
		if ( ! pendingPrompt || ! ownerSite || pendingPrompt.siteId !== ownerSite.id ) {
			return;
		}
		if ( isFetching || ! data ) {
			return;
		}
		if ( sentPendingPromptRef.current === pendingPrompt ) {
			return;
		}
		sentPendingPromptRef.current = pendingPrompt;
		pendingSessionPromptSlot.clear();
		void sendMessageWithConsole( pendingPrompt.prompt, {
			images: pendingPrompt.images,
			files: pendingPrompt.files,
		} );
	}, [ pendingPrompt, ownerSite, isFetching, data, sendMessageWithConsole ] );
	const siteSessionHistory = useMemo(
		() =>
			data
				? getSiteSessionHistory( {
						currentSession: data.summary,
						ownerSitePath: ownerSite?.path,
						sessions,
				  } )
				: [],
		[ data, ownerSite?.path, sessions ]
	);
	const archivedSiteSessionHistory = useMemo(
		() =>
			data
				? getSiteArchivedSessionHistory( {
						currentSession: data.summary,
						ownerSitePath: ownerSite?.path,
						sessions,
				  } )
				: [],
		[ data, ownerSite?.path, sessions ]
	);

	const handleAnnotationsDone = useCallback(
		( annotations: Annotation[] ) => {
			if ( annotations.length === 0 ) return;
			void sendMessageWithConsole( formatAnnotationsAsPrompt( annotations ), {
				displayMessage: formatAnnotationsSubmittedMessage( annotations.length ),
			} );
		},
		[ sendMessageWithConsole ]
	);
	const handleScreenshotDone = useCallback( async ( file: File ) => {
		const composer = composerRef.current;
		if ( ! composer ) {
			throw new Error( 'Composer is not ready.' );
		}
		const didAdd = await composer.addFiles( [ file ] );
		if ( ! didAdd ) {
			throw new Error( __( 'Screenshot could not be added.' ) );
		}
	}, [] );
	const handleConsoleFileDone = useCallback(
		async ( file: PreviewConsoleTextFile ) => {
			const composer = composerRef.current;
			if ( ! composer ) {
				throw new Error( 'Composer is not ready.' );
			}
			const path = await connector.createTemporaryTextFile( file.name, file.contents );
			const didAdd = composer.addFileAttachments( [
				{
					id: `console-${ Date.now().toString( 36 ) }-${ Math.random()
						.toString( 36 )
						.slice( 2, 10 ) }`,
					name: file.name,
					path,
					mimeType: file.mimeType,
					size: file.size,
				},
			] );
			if ( ! didAdd ) {
				throw new Error( __( 'Console messages could not be attached.' ) );
			}
		},
		[ connector ]
	);
	// The preview panel itself is hosted by the dashboard layout; route its
	// actions to this session while it is on screen.
	useSessionPreviewAnnotations( handleAnnotationsDone, canTogglePreview );
	useSessionPreviewScreenshot( handleScreenshotDone, canTogglePreview );
	useSessionPreviewConsoleFile( handleConsoleFileDone, canTogglePreview );

	const switchSession = useCallback(
		( nextSessionId: string ) =>
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: nextSessionId },
			} ),
		[ navigate ]
	);
	const reopenQueuedPrompt = useCallback(
		( queuedPrompt: ( typeof queuedPrompts )[ number ] ) => {
			removeQueuedPrompt( queuedPrompt.id );
			composerRef.current?.replaceDraft( stripPreviewConsolePromptBlock( queuedPrompt.prompt ), {
				images: queuedPrompt.images,
				files: queuedPrompt.files,
			} );
		},
		[ removeQueuedPrompt ]
	);
	const startNewChat = useCallback( async () => {
		if ( ! ownerSite ) {
			return;
		}
		try {
			const summary = await createSession( ownerSite.id );
			switchSession( summary.id );
		} catch {
			// The mutation owns the error state; avoid an unhandled rejection
			// from this command button if session creation fails.
		}
	}, [ createSession, ownerSite, switchSession ] );

	const autoScrolledSessionRef = useRef< string | undefined >( undefined );
	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node || pendingQuestions.length > 0 ) {
			return;
		}
		// Stick-to-bottom: once the user scrolls up, stop following new
		// content — but always land at the bottom when switching sessions.
		const sessionChanged = autoScrolledSessionRef.current !== sessionId;
		autoScrolledSessionRef.current = sessionId;
		if ( ! sessionChanged && ! isAtBottomRef.current ) {
			return;
		}
		node.scrollTop = node.scrollHeight;
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data, isRunning, pendingQuestions.length, queuedPrompts.length, isAtBottomRef ] );

	if ( isLoading ) {
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
				footer={ <SessionChatActionsSkeleton /> }
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
			header={ <SessionHeader summary={ data.summary } /> }
			composer={
				<div className={ clsx( styles.classicColumn, styles.classicComposerColumn ) }>
					<QueuedPrompts
						prompts={ queuedPrompts }
						onRemove={ removeQueuedPrompt }
						onEdit={ reopenQueuedPrompt }
					/>
					<Composer
						ref={ composerRef }
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						model={ currentModel }
						onSend={ sendMessageWithConsole }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ switchSession }
					/>
				</div>
			}
			composerOverlay={
				<ScrollToBottomButton visible={ ! isAtBottom } onClick={ scrollToBottom } />
			}
			footer={
				ownerSite ? (
					<SessionChatActions
						archivedSessions={ archivedSiteSessionHistory }
						canTogglePreview={ canTogglePreview }
						currentSessionId={ sessionId }
						isCreatingSession={ isCreatingSession }
						onNewChat={ startNewChat }
						onSwitchSession={ switchSession }
						sessions={ siteSessionHistory }
					/>
				) : null
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
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
					pendingPermissions={ pendingPermissionIds }
					answeredPermissions={ answeredPermissions }
					onAnswerQuestion={ answerQuestion }
					onAnswerPermission={ answerPermissionAndRefocus }
				/>
			</div>
		</SessionFrame>
	);
}
