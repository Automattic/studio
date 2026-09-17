import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/common/ai/providers';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	getStudioCodeAiAccessState,
	hasPaidAiCredits,
} from '@studio/common/lib/studio-assistant-quota';
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
	useSyncExternalStore,
	type ReactNode,
	type Ref,
} from 'react';
import { AgenticSigninPrompt } from '@/components/agentic-signin-banner';
import { OutOfCreditsNotice } from '@/components/ai-access-required-notice';
import { OpenInMenu } from '@/components/open-in-menu';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteIcon } from '@/components/site-icon';
import { type Annotation } from '@/components/site-preview/types';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import {
	useCreateSession,
	useSession,
	useSessionEffectiveEnvironment,
	useSessions,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider, useSessionPreviewAnnotations } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { formatComposerTextQuote, watchComposerTextQuote } from '@/lib/composer-text-quote';
import { pendingPromptSlot } from '@/lib/pending-prompt';
import { AccessRequirements } from './access-requirements';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { EmptyBackground } from './empty-background';
import { QueuedPrompts } from './queued-prompts';
import { getSiteSessionHistory, SessionChatActions } from './session-chat-actions';
import styles from './style.module.css';
import { SuggestedPrompts } from './suggested-prompts';
import type { SiteDetails } from '@/data/core';

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

// Kept outside the component: the React Compiler lint reads a direct
// `scrollTop` store on a state-held node as a state mutation.
function scrollToEnd( node: HTMLElement ) {
	node.scrollTop = node.scrollHeight;
}

function SessionHeader( {
	siteName,
	site,
	effectiveEnvironment,
}: {
	siteName?: string;
	site?: SiteDetails;
	effectiveEnvironment: 'local' | 'live';
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
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
			{ site ? (
				<div className={ styles.headerActions }>
					<OpenInMenu key={ site.id } site={ site } />
				</div>
			) : null }
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

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		const updateChromeSize = () => {
			root.style.setProperty( '--header-height', `${ headerRef.current?.offsetHeight ?? 0 }px` );
			const composerHeight = composerRef.current?.offsetHeight ?? 0;
			root.style.setProperty( '--composer-height', `${ composerHeight }px` );
			// The collapsed-sidebar toast shelf lives in the layout's <main>, an
			// ancestor of this root, so it can't inherit the value from here.
			// Publishing it on the document lets the shelf ride above the composer
			// however it grows — wrapped text, attachments, or the resize handle.
			document.documentElement.style.setProperty(
				'--app-main-composer-height',
				`${ composerHeight }px`
			);
			// The shelf's start edge lines up with the composer box, wherever
			// the reading column puts it.
			const composerBox = composerRef.current?.firstElementChild;
			if ( composerBox && root ) {
				const left = composerBox.getBoundingClientRect().left - root.getBoundingClientRect().left;
				document.documentElement.style.setProperty( '--app-main-composer-left', `${ left }px` );
			}
		};

		updateChromeSize();

		// Views without a composer must fall back to the shelf's 0px default.
		const clearComposerHeight = () => {
			document.documentElement.style.removeProperty( '--app-main-composer-height' );
			document.documentElement.style.removeProperty( '--app-main-composer-left' );
		};

		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateChromeSize );
			return () => {
				window.removeEventListener( 'resize', updateChromeSize );
				clearComposerHeight();
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
			clearComposerHeight();
		};
	}, [] );

	return (
		<div ref={ rootRef } className={ clsx( styles.root, footer && styles.rootWithFooter ) }>
			<div ref={ headerRef } className={ styles.headerLayer }>
				{ header }
			</div>
			<div ref={ scrollRef } className={ styles.scroll }>
				{ children }
			</div>
			<ProgressiveBlur direction="down" className={ styles.headerBlur } fadeToSurface />
			{ composer ? (
				<>
					<ProgressiveBlur direction="up" className={ styles.composerBlur } fadeToSurface />
					<div ref={ composerRef } className={ styles.composerOuter }>
						{ composer }
					</div>
				</>
			) : null }
			{ footer ? (
				<div className={ clsx( styles.panelFooterControls, styles.panelFooterControlsStart ) }>
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

export function SignedOutSessionView( { siteId }: { siteId: string } ) {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const { enabled, isReady, reason, chatPromptsSignIn } = useAgenticFeatures();
	// `reason` dips through null while auth reloads, so the signed-out state has
	// to be latched — the preceding value is never 'signed-out' when it matters.
	const wasSignedOutRef = useRef( false );

	useEffect( () => {
		if ( reason === 'signed-out' ) {
			wasSignedOutRef.current = true;
		}
		if ( enabled && wasSignedOutRef.current ) {
			wasSignedOutRef.current = false;
			void navigate( { to: '/', replace: true } );
			return;
		}
		if ( isReady && ! enabled && ! chatPromptsSignIn ) {
			void navigate( {
				to: '/sites/$siteId/overview',
				params: { siteId },
				replace: true,
			} );
		}
	}, [ chatPromptsSignIn, enabled, isReady, navigate, reason, siteId ] );

	return (
		<SessionFrame
			header={
				<SessionHeader siteName={ site?.name } site={ site } effectiveEnvironment="local" />
			}
			footer={ <div aria-hidden /> }
			footerEnd={ site ? <PreviewToggleButton /> : null }
		>
			<AgenticSigninPrompt
				onOpenOverview={ () =>
					void navigate( { to: '/sites/$siteId/overview', params: { siteId } } )
				}
			/>
		</SessionFrame>
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
		clearQuestionAnswer,
		removeQueuedPrompt,
	} = useAgentRun( sessionId );
	const {
		data: quota,
		isLoading: isQuotaLoading,
		isFetching: isQuotaFetching,
		refetch: refetchQuota,
	} = useStudioAssistantQuota();
	const { data: aiSettings } = useAiSettings();
	// A fresh wpcom session defaults to balanced when purchased credits
	// remain, fast otherwise.
	const currentModel = useMemo( () => {
		const entries = data?.entries ?? [];
		return resolveSessionModelForProvider(
			entries,
			getEffectiveSessionProvider( entries, aiSettings ),
			{ hasPaidAiCredits: hasPaidAiCredits( quota ) }
		);
	}, [ data?.entries, aiSettings, quota ] );
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	// Which question the user chose to answer in their own words. Derived, so a
	// stale prompt can't outlive the batch it belongs to.
	const [ armedFreeFormQuestion, setArmedFreeFormQuestion ] = useState< string | null >( null );
	const freeFormQuestion =
		armedFreeFormQuestion && pendingQuestionTexts.has( armedFreeFormQuestion )
			? armedFreeFormQuestion
			: null;
	const isEmpty = useMemo(
		() =>
			! ( data?.entries ?? [] ).some(
				( entry ) => entry.type === 'custom' && entry.customType === 'studio.user_prompt'
			),
		[ data?.entries ]
	);
	// The scroller only exists in the loaded frame, which can mount well after
	// the session data arrives (a cold start serves the session from the
	// persisted cache while the quota check is still pending). Keeping the node
	// in state lets the scroll effects re-run when it appears; a ref can't.
	const [ scrollNode, setScrollNode ] = useState< HTMLDivElement | null >( null );
	const composerRef = useRef< ComposerHandle >( null );
	useEffect(
		() =>
			watchComposerTextQuote( ( text ) => {
				composerRef.current?.appendDraft( formatComposerTextQuote( text ) );
			} ),
		[]
	);
	const chooseFreeFormAnswer = useCallback(
		( question: string ) => {
			// Retract any option already picked for this question: the typed reply
			// replaces it, and leaving it in place would dispatch the stale pick.
			clearQuestionAnswer( question );
			setArmedFreeFormQuestion( question );
			composerRef.current?.focus();
		},
		[ clearQuestionAnswer ]
	);
	// Picking a listed option supersedes an armed free-form reply for that same
	// question. Answering a *different* one leaves the arming alone, and
	// arming again after picking still works, so a pick stays changeable.
	const answerQuestionFromOption = useCallback(
		( question: string, label: string ) => {
			setArmedFreeFormQuestion( ( armed ) => ( armed === question ? null : armed ) );
			answerQuestion( question, label );
		},
		[ answerQuestion ]
	);
	// The batch blocks the run until every question has an answer, so a reply
	// belongs to the one the agent is still waiting on — the armed question when
	// the user picked one, otherwise the next unanswered in order.
	const targetQuestion =
		freeFormQuestion ??
		pendingQuestions.find( ( q ) => typeof pendingAnswers[ q.question ] !== 'string' )?.question ??
		null;
	const answerTargetQuestion = useCallback(
		( answer: string ) => {
			if ( ! targetQuestion ) {
				return;
			}
			setArmedFreeFormQuestion( null );
			answerQuestion( targetQuestion, answer );
		},
		[ answerQuestion, targetQuestion ]
	);
	const [ isScrolledAway, setIsScrolledAway ] = useState( false );

	const updateIsScrolledAway = useCallback( () => {
		if ( scrollNode ) {
			setIsScrolledAway( isScrolledAwayFromLatest( scrollNode ) );
		}
	}, [ scrollNode ] );

	useEffect( () => {
		if ( ! scrollNode ) {
			return;
		}
		updateIsScrolledAway();
		scrollNode.addEventListener( 'scroll', updateIsScrolledAway, { passive: true } );
		return () => scrollNode.removeEventListener( 'scroll', updateIsScrolledAway );
	}, [ scrollNode, updateIsScrolledAway ] );

	// Content can grow without emitting scroll events (e.g. while the
	// auto-scroll below is suspended by pending questions), so re-check
	// whenever the transcript changes.
	useEffect( () => {
		updateIsScrolledAway();
	}, [ data, pendingQuestions.length, queuedPrompts.length, updateIsScrolledAway ] );

	useLayoutEffect( () => {
		setIsScrolledAway( false );
	}, [ sessionId ] );

	const scrollToLatest = useCallback( () => {
		if ( ! scrollNode ) {
			return;
		}
		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		scrollNode.scrollTo( {
			top: scrollNode.scrollHeight,
			behavior: prefersReducedMotion ? 'auto' : 'smooth',
		} );
	}, [ scrollNode ] );
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
			const summary = await createSession( { siteId: ownerSite.id } );
			switchSession( summary.id );
		} catch {
			// The mutation owns the error state; avoid an unhandled rejection
			// from this command button if session creation fails.
		}
	}, [ createSession, isEmpty, ownerSite, switchSession ] );

	useLayoutEffect( () => {
		if ( ! scrollNode || isScrolledAway || pendingQuestions.length > 0 ) {
			return;
		}
		scrollToEnd( scrollNode );
		const id = requestAnimationFrame( () => scrollToEnd( scrollNode ) );
		return () => cancelAnimationFrame( id );
	}, [
		scrollNode,
		sessionId,
		data,
		isRunning,
		isScrolledAway,
		pendingQuestions.length,
		queuedPrompts.length,
	] );

	// Out of credits swaps the composer for the purchase offer, unless a run is
	// still in flight — the Stop button lives in the composer.
	const isOutOfCredits = useIsOutOfAiCredits();
	// Fail open when the quota is unavailable (offline, error, older server) —
	// the WordPress.com proxy enforces the same gate server-side.
	const isAccessBlocked =
		!! quota && ( getStudioCodeAiAccessState( quota ) !== 'available' || ! quota.hasPaymentMethod );

	// The create-site flow's brief goes out as if typed here, but only once the
	// chat is usable — it must not be fired into a gated view.
	const handedOver = useSyncExternalStore(
		pendingPromptSlot.subscribe,
		pendingPromptSlot.getSnapshot
	);
	const pendingPrompt = handedOver?.sessionId === sessionId ? handedOver : null;
	const isChatReady = !! data && ! isQuotaLoading && ! isAccessBlocked && ! isOutOfCredits;
	useEffect( () => {
		// Read the slot live rather than the rendered value: StrictMode runs the
		// effect twice for one render, and the second pass must find it empty.
		const prompt = pendingPromptSlot.getSnapshot();
		if ( ! isChatReady || prompt?.sessionId !== sessionId ) return;
		pendingPromptSlot.clear( prompt );
		void sendMessage( prompt.prompt, prompt.attachments ).catch( () => {
			composerRef.current?.replaceDraft( prompt.prompt, prompt.attachments );
		} );
	}, [ isChatReady, pendingPrompt, sendMessage, sessionId ] );

	// Fade the composer and prompts in only right after the entitlement check
	// resolves; ordinary session loads and switches render instantly. The
	// render-time latch has the class on from the first post-resolve frame;
	// the timeout retires it so later remounts don't animate.
	const [ sawQuotaLoading, setSawQuotaLoading ] = useState( false );
	if ( isQuotaLoading && ! sawQuotaLoading ) {
		setSawQuotaLoading( true );
	}
	const fadeAfterQuotaCheck = sawQuotaLoading && ! isQuotaLoading;
	useEffect( () => {
		if ( ! fadeAfterQuotaCheck ) {
			return;
		}
		// Outlives the 180ms fade so a mid-animation re-render can't strip it.
		const id = setTimeout( () => setSawQuotaLoading( false ), 300 );
		return () => clearTimeout( id );
	}, [ fadeAfterQuotaCheck ] );

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

	// isQuotaLoading holds the composer back until the entitlement check
	// resolves, so the view settles once — gate or chat — with no composer
	// flash. Signed-out and failed quota queries report isLoading false.
	if ( isLoading || notFound || ! data || isQuotaLoading ) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the EmptyBackground canvas jumps
		// mid-transition.
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ clsx( styles.column, styles.composerColumn ) }>
						<ComposerSkeleton />
					</div>
				}
				footer={ <div aria-hidden /> }
			>
				<EmptyBackground />
			</SessionFrame>
		);
	}

	if ( quota && isAccessBlocked ) {
		return (
			<SessionFrame
				header={
					<SessionHeader
						siteName={ data.summary.ownerSiteName }
						site={ ownerSite }
						effectiveEnvironment={ effectiveEnvironment }
					/>
				}
				footer={ <div aria-hidden /> }
			>
				<EmptyBackground />
				<AccessRequirements
					quota={ quota }
					isRechecking={ isQuotaFetching }
					onRecheck={ () => void refetchQuota() }
				/>
			</SessionFrame>
		);
	}

	return (
		<SessionFrame
			scrollRef={ setScrollNode }
			header={
				<SessionHeader
					siteName={ data.summary.ownerSiteName }
					site={ ownerSite }
					effectiveEnvironment={ effectiveEnvironment }
				/>
			}
			composer={
				<div
					className={ clsx(
						styles.column,
						styles.composerColumn,
						fadeAfterQuotaCheck && styles.fadeInQuick
					) }
				>
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
					{ isOutOfCredits && ! composerBusy ? (
						<OutOfCreditsNotice />
					) : (
						<Composer
							ref={ composerRef }
							busy={ composerBusy }
							awaitingAnswer={ pendingQuestions.length > 0 }
							canSubmit={ ! isOutOfCredits }
							isInterrupting={ isInterrupting }
							error={ runError }
							model={ currentModel }
							onSend={ sendMessage }
							onAnswer={ targetQuestion ? answerTargetQuestion : undefined }
							onInterrupt={ interrupt }
							sessionId={ sessionId }
							entries={ data.entries }
							ownerSiteId={ ownerSite?.id }
							onSwitchSession={ switchSession }
						/>
					) }
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
						showNewChat={ ! isOutOfCredits }
					/>
				) : null
			}
			footerEnd={ canTogglePreview ? <PreviewToggleButton /> : null }
		>
			{ isEmpty && ! pendingPrompt ? <EmptyBackground /> : null }
			{ isEmpty && ! pendingPrompt && ownerSite && ! isOutOfCredits ? (
				<SuggestedPrompts
					fadeIn={ fadeAfterQuotaCheck }
					siteName={ ownerSite.name }
					onPick={ ( prompt ) =>
						composerRef.current?.replaceDraft( prompt, { suggestionBaseline: prompt } )
					}
					getDraft={ () =>
						composerRef.current?.getDraft() ?? {
							text: '',
							hasAttachments: false,
							suggestionBaseline: null,
						}
					}
				/>
			) : null }
			<div className={ clsx( styles.column, styles.conversationSpacing ) }>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					freeFormQuestion={ freeFormQuestion }
					onAnswerQuestion={ answerQuestionFromOption }
					onChooseFreeForm={ chooseFreeFormAnswer }
				/>
				<QueuedPrompts
					prompts={ queuedPrompts }
					onRemove={ removeQueuedPrompt }
					onEdit={ reopenQueuedPrompt }
				/>
			</div>
		</SessionFrame>
	);
}
