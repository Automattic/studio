import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/common/ai/providers';
import { pickLiveSite } from '@studio/common/ai/sessions/effective-site';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	getStudioCodeAiAccessState,
	hasPaidAiCredits,
} from '@studio/common/lib/studio-assistant-quota';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { arrowDown } from '@wordpress/icons';
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
import {
	getSiteAnnotations,
	hasAnnotationContent,
	removeAnnotations,
	stageAnnotations,
	subscribeAnnotationSend,
} from '@/components/annotations/store';
import { annotationSubmission } from '@/components/annotations/submission';
import { OpenChatShortcuts } from '@/components/chat-actions';
import { PreviewParticles } from '@/components/preview-particles';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { HeaderSidebarToggle } from '@/components/sidebar-toggle';
import { SiteActionsMenu } from '@/components/site-actions-menu';
import { SiteHeaderSpace, useSiteHeader } from '@/components/site-header-actions';
import { SiteIcon } from '@/components/site-icon';
import { SiteContextMenu, StoppedSitePreview } from '@/components/stopped-site-preview';
import { Button, IconButton } from '@/components/ui/button';
import { toast } from '@/data/app-messages';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useSession,
	useSessionEffectiveEnvironment,
	useSetSessionEnvironment,
} from '@/data/queries/use-sessions';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import { useMarkChatRead } from '@/hooks/use-mark-chat-read';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsInset } from '@/hooks/use-window-controls-inset';
import { formatComposerTextQuote, watchComposerTextQuote } from '@/lib/composer-text-quote';
import { pendingPromptSlot } from '@/lib/pending-prompt';
import { AccessRequirements } from './access-requirements';
import { Composer, ComposerSkeleton, type ComposerHandle } from './composer';
import { Conversation } from './conversation';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
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
	const windowControlsInset = useWindowControlsInset( 'toolbar' );
	const { host } = useSiteHeader();
	const local = site && effectiveEnvironment === 'local';

	return (
		<div
			data-site-header
			className={ clsx(
				styles.header,
				sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
			) }
			style={
				windowControlsInset > 0
					? {
							paddingRight: windowControlsInset + 8,
					  }
					: undefined
			}
		>
			<div data-site-header-reserved className={ styles.headerLead }>
				<HeaderSidebarToggle />
				{ site ? <SiteActionsMenu site={ site } /> : null }
				{ ! site && siteName ? (
					<>
						<SiteIcon className={ styles.headerSiteIcon } seed={ siteName } />
						<span className={ styles.headerSite }>{ siteName }</span>
						<span className={ styles.headerDot } aria-hidden="true" />
						<span className={ styles.headerEnv }>
							{ effectiveEnvironment === 'live' ? __( 'Live' ) : __( 'Local' ) }
						</span>
					</>
				) : null }
			</div>
			<span className={ styles.headerSpacer } aria-hidden="true" />
			{ local && site.running ? (
				<div data-site-header-reserved className={ styles.headerActions } data-header-actions>
					<PreviewToggleButton canHideChat />
				</div>
			) : null }
			{ local && host === 'chat' ? <SiteHeaderSpace /> : null }
		</div>
	);
}

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	rootRef?: ( node: HTMLDivElement | null ) => void;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
function SessionFrame( {
	header,
	composer,
	scrollRef,
	rootRef: onRootNode,
	children,
}: SessionFrameProps ) {
	const rootRef = useRef< HTMLDivElement | null >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		const updateChromeSize = () => {
			root.style.setProperty( '--header-height', `${ headerRef.current?.offsetHeight ?? 0 }px` );
			root.style.setProperty(
				'--composer-height',
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
		<div
			ref={ ( node ) => {
				rootRef.current = node;
				onRootNode?.( node );
			} }
			className={ styles.root }
		>
			<div ref={ headerRef } className={ styles.headerLayer }>
				{ header }
			</div>
			<div ref={ scrollRef } className={ styles.scroll }>
				{ children }
			</div>
			{ composer ? (
				<>
					<ProgressiveBlur direction="up" className={ styles.composerBlur } fadeToSurface />
					<div ref={ composerRef } className={ styles.composerOuter }>
						{ composer }
					</div>
				</>
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
				to: '/sites/$siteId',
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
		>
			<AgenticSigninPrompt
				onTurnedOff={ () => void navigate( { to: '/sites/$siteId', params: { siteId } } ) }
			/>
		</SessionFrame>
	);
}

function SessionViewContent( { sessionId }: { sessionId: string } ) {
	const navigate = useNavigate();
	const { data, isLoading, error, refetch } = useSession( sessionId );
	const { data: sites } = useSites();
	const ownerSite = findAiSessionOwnerSite( sites, data?.summary );
	const effectiveEnvironment = useSessionEffectiveEnvironment( data?.summary, ownerSite?.id );
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
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
	const sessionProvider = getEffectiveSessionProvider( data?.entries ?? [], aiSettings );
	const isWpcom = sessionProvider === 'wpcom';
	// A fresh wpcom session defaults to balanced when purchased credits
	// remain, fast otherwise.
	const currentModel = useMemo(
		() =>
			resolveSessionModelForProvider( data?.entries ?? [], sessionProvider, {
				hasPaidAiCredits: hasPaidAiCredits( quota ),
			} ),
		[ data?.entries, sessionProvider, quota ]
	);
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
	const annotationSiteId = canTogglePreview ? ownerSite.id : undefined;

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

	const isOutOfCredits = useIsOutOfAiCredits() && isWpcom;
	useMarkChatRead( sessionId, data?.summary.unread );
	// Fail open when the quota is unavailable (offline, error, older server) —
	// the WordPress.com proxy enforces the same gate server-side.
	const isAccessBlocked =
		isWpcom &&
		!! quota &&
		( getStudioCodeAiAccessState( quota ) !== 'available' || ! quota.hasPaymentMethod );

	const [ frameNode, setFrameNode ] = useState< HTMLDivElement | null >( null );
	const { data: preferences } = useUserPreferences();
	const { mutate: startSite } = useStartSite();
	const isSiteStarting = useIsSiteStarting( ownerSite?.id );
	const isSiteStopping = useIsSiteStopping( ownerSite?.id );
	const isSiteBusy = useIsSiteBusy( ownerSite );
	const canAutoStart = !! ownerSite && effectiveEnvironment === 'local';
	const { data: connectedSites } = useConnectedWpcomSites( ownerSite?.id );
	const liveSite = pickLiveSite( connectedSites ?? [] );
	const { mutate: setEnvironment } = useSetSessionEnvironment( sessionId );
	const sendWithAutoStart = useCallback(
		( prompt: string, attachments?: Parameters< typeof sendMessage >[ 1 ] ) => {
			if (
				canAutoStart &&
				preferences?.autoStartSiteOnChat &&
				! ownerSite.running &&
				! isSiteBusy
			) {
				startSite( ownerSite.id );
			}
			return sendMessage( prompt, attachments );
		},
		[ canAutoStart, isSiteBusy, ownerSite, preferences, sendMessage, startSite ]
	);
	const composerPlaceholder = ownerSite
		? sprintf(
				isSiteStarting
					? /* translators: %s: site name. */ __( 'Starting %s' )
					: isSiteStopping
					? /* translators: %s: site name. */ __( 'Stopping %s' )
					: /* translators: %s: site name. */ __( 'Work with %s' ),
				ownerSite.name
		  )
		: undefined;

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

	// Notes sent from the preview land in the composer, then go out with its
	// draft, or alone when they were sent directly. While the agent works they
	// wait in the composer.
	useEffect( () => {
		if ( ! isChatReady || ! annotationSiteId ) return;
		return subscribeAnnotationSend( annotationSiteId, ( { noteIds } ) => {
			stageAnnotations( annotationSiteId, noteIds );
			if ( composerBusy ) return;
			if ( ! noteIds ) {
				return composerRef.current?.send();
			}
			const notes = getSiteAnnotations( annotationSiteId ).notes.filter(
				( note ) => noteIds.includes( note.id ) && hasAnnotationContent( note )
			);
			try {
				const { prompt, options } = annotationSubmission( '', [], notes );
				return sendMessage( prompt, options )
					.then( () => removeAnnotations( annotationSiteId, noteIds ) )
					.catch( () => undefined );
			} catch ( error ) {
				toast.error( ( error as Error ).message );
			}
		} );
	}, [ annotationSiteId, composerBusy, isChatReady, sendMessage ] );

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
	// root (the next available site); the skeleton below covers the redirect.
	const notFound = !! error && /session not found/i.test( error.message );
	useEffect( () => {
		if ( notFound ) {
			void navigate( { to: '/' } );
		}
	}, [ notFound, navigate ] );

	// isQuotaLoading holds the composer back until the entitlement check
	// resolves, so the view settles once — gate or chat — with no composer
	// flash. Signed-out and failed quota queries report isLoading false.
	if ( error && ! data && ! notFound ) {
		return (
			<SessionFrame header={ <div className={ styles.header } /> }>
				<div className={ styles.loadError } role="alert">
					<span>{ __( 'This chat could not load.' ) }</span>
					<Button variant="outline" onClick={ () => void refetch() }>
						{ __( 'Try again' ) }
					</Button>
				</div>
			</SessionFrame>
		);
	}

	if ( isLoading || notFound || ! data || isQuotaLoading ) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the empty-state dots jump
		// mid-transition.
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ clsx( styles.column, styles.composerColumn ) }>
						<ComposerSkeleton />
					</div>
				}
			>
				<div className={ styles.emptyState }>
					<PreviewParticles />
				</div>
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
			>
				<div className={ styles.emptyState }>
					<PreviewParticles />
				</div>
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
			rootRef={ setFrameNode }
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
					<QueuedPrompts
						prompts={ queuedPrompts }
						onRemove={ removeQueuedPrompt }
						onEdit={ reopenQueuedPrompt }
					/>
					{ isScrolledAway ? (
						<div className={ styles.scrollToLatestWrap }>
							<IconButton
								className={ styles.scrollToLatestButton }
								icon={ arrowDown }
								label={ __( 'Jump to latest' ) }
								variant="outline"
								shape="round"
								onClick={ scrollToLatest }
							/>
						</div>
					) : null }
					<Composer
						ref={ composerRef }
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						model={ currentModel }
						onSend={ sendWithAutoStart }
						onAnswer={ targetQuestion ? answerTargetQuestion : undefined }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						entries={ data.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ switchSession }
						placeholder={ composerPlaceholder }
						placeholderBusy={ isSiteStarting || isSiteStopping }
						canAutoStart={ canAutoStart }
						environment={ effectiveEnvironment }
						liveUrl={ liveSite?.url }
						onEnvironmentChange={ ownerSite ? setEnvironment : undefined }
						dropTarget={ frameNode }
						annotationSiteId={ annotationSiteId }
					/>
				</div>
			}
		>
			<OpenChatShortcuts session={ data.summary } />
			{ isEmpty && ! pendingPrompt ? (
				<SiteContextMenu site={ ownerSite } disabled={ ! ownerSite || ownerSite.running }>
					<div className={ styles.emptyState }>
						<PreviewParticles active={ isSiteStarting } showLogo={ isSiteStarting } />
						{ ownerSite && ! ownerSite.running && ! isSiteStarting ? (
							<StoppedSitePreview site={ ownerSite } />
						) : null }
					</div>
				</SiteContextMenu>
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
			</div>
		</SessionFrame>
	);
}
