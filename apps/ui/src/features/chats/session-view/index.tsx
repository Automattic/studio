import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/agent/protocol/providers';
import { pickLiveSite } from '@studio/agent/protocol/sessions/effective-site';
import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ArrowDownIcon } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from 'react';
import { useAgentRun } from '@/data/agent-runs/use-agent-run';
import { toast } from '@/data/app-messages';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useIsOutOfAiCredits } from '@/data/queries/use-is-out-of-ai-credits';
import {
	useSession,
	useSessionLiveSite,
	useSessions,
	useSetSessionEnvironment,
} from '@/data/queries/use-sessions';
import { useSiteChatDraft } from '@/data/queries/use-site-chat-draft';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSelectionTime } from '@/data/use-open-site';
import { SessionUIProvider, useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { useStartSitePreview } from '@/data/use-start-site-preview';
import {
	getSiteAnnotations,
	hasAnnotationContent,
	removeAnnotations,
	stageAnnotations,
	subscribeAnnotationSend,
	annotationSubmission,
} from '@/features/annotations';
import {
	formatComposerTextQuote,
	watchComposerTextQuote,
} from '@/features/chats/composer-text-quote';
import {
	Composer,
	ComposerSkeleton,
	pendingPromptSlot,
	type ComposerHandle,
} from '@/features/composer';
import { PreviewParticles, StoppedSitePreview } from '@/features/sites';
import { getMotionDuration } from '@/lib/theme';
import { Button, IconButton } from '@/lib/ui';
import { Conversation } from './conversation';
import { QueuedPrompts } from './queued-prompts';
import { SessionFrame } from './session-frame';
import { SessionHeader } from './session-header';
import styles from './style.module.css';
import { useAnchoredScroll } from './use-anchored-scroll';
import { useComposerNotice } from './use-composer-notice';
import { useMarkChatRead } from './use-mark-chat-read';
import { useSendSiteDraft } from './use-send-site-draft';
import { useSessionCommands } from './use-session-commands';

interface SessionViewProps {
	sessionId?: string;
	siteId?: string;
	headerStart?: ReactNode;
	hideHeader?: boolean;
}

export function SessionView( props: SessionViewProps ) {
	return (
		<SessionUIProvider>
			<SessionViewContent { ...props } />
		</SessionUIProvider>
	);
}

function SessionViewContent( { sessionId, siteId, headerStart, hideHeader }: SessionViewProps ) {
	const draftKey = sessionId ?? `site:${ siteId }`;
	const { draft, update: updateDraft } = useSiteChatDraft( siteId );
	const sendDraft = useSendSiteDraft( siteId );
	const navigate = useNavigate();
	const { data, isLoading, error, refetch } = useSession( sessionId );
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const sessionSummary = data?.summary ?? sessions?.find( ( session ) => session.id === sessionId );
	const ownerSite = sessionId
		? findAiSessionOwnerSite( sites, sessionSummary )
		: sites?.find( ( site ) => site.id === siteId );
	useEffect( () => {
		if ( ! sessionId && sites && ! ownerSite ) {
			void navigate( { to: '/' } );
		}
	}, [ navigate, ownerSite, sessionId, sites ] );
	const effectiveEnvironment = useSessionLiveSite(
		sessionId ? sessionSummary : draft,
		ownerSite?.id
	)
		? 'live'
		: 'local';
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
		sendMessage: sendSessionMessage,
		interrupt,
		answerQuestion,
		clearQuestionAnswer,
		removeQueuedPrompt,
	} = useAgentRun( sessionId );
	const {
		data: quota,
		isLoading: isQuotaPending,
		isFetched: isQuotaFetched,
	} = useStudioAssistantQuota();
	const { data: authUser } = useAuthUser();
	// Refetching a failed check (opening the model picker does) puts the query
	// back to pending; only the first check holds the chat back.
	const isQuotaLoading = isQuotaPending && ! isQuotaFetched;
	const { data: aiSettings } = useAiSettings();
	const sessionProvider =
		( ! sessionId && draft.provider ) ||
		getEffectiveSessionProvider( data?.entries ?? [], aiSettings );
	const isWpcom = sessionProvider === 'wpcom';
	const notice = useComposerNotice( sessionProvider, ownerSite?.id );
	// A fresh wpcom session defaults to balanced when the paid tiers are
	// unlocked, fast otherwise.
	const defaultModel = useMemo(
		() =>
			resolveSessionModelForProvider( data?.entries ?? [], sessionProvider, {
				canUsePaidModels: canUsePaidAiModels( quota, authUser?.email ),
			} ),
		[ data?.entries, sessionProvider, quota, authUser?.email ]
	);
	const currentModel = ( ! sessionId && draft.model ) || defaultModel;
	const sendMessage = useCallback(
		( prompt: string, options?: Parameters< typeof sendSessionMessage >[ 1 ] ) =>
			sessionId
				? sendSessionMessage( prompt, options )
				: sendDraft( prompt, options, sessionProvider, currentModel ),
		[ sessionId, sendSessionMessage, sendDraft, sessionProvider, currentModel ]
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
	const router = useRouter();
	useEffect( () => {
		if ( sessionId ) return;
		return router.subscribe( 'onResolved', ( { pathChanged, hrefChanged } ) => {
			if ( ! pathChanged && hrefChanged ) return;
			if ( router.state.location.pathname === `/sites/${ siteId }/new` ) {
				composerRef.current?.focus();
			}
		} );
	}, [ router, sessionId, siteId ] );
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
	const { spacerRef, isScrolledAway, scrollToLatest } = useAnchoredScroll( {
		scrollNode,
		sessionId: draftKey,
		content: data,
		paused: pendingQuestions.length > 0,
	} );
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

	const isOutOfCredits = useIsOutOfAiCredits() && isWpcom;
	useMarkChatRead( sessionId, data?.summary, hasActiveRun );

	const [ frameNode, setFrameNode ] = useState< HTMLDivElement | null >( null );
	const { data: preferences } = useUserPreferences();
	const { mutate: startSite } = useStartSite();
	const { mutate: startSitePreview } = useStartSitePreview();
	const isSiteStarting = useIsSiteStarting( ownerSite?.id );
	const isSiteStopping = useIsSiteStopping( ownerSite?.id );
	const revealingSiteId = useOptionalSessionPreviewUI()?.revealingSiteId;
	const siteLoading =
		isSiteStarting || isSiteStopping || ( !! ownerSite && revealingSiteId === ownerSite.id );
	const selectionTime = useSiteSelectionTime( ownerSite?.id );
	const isSiteBusy = useIsSiteBusy( ownerSite );
	const canAutoStart = !! ownerSite && effectiveEnvironment === 'local';
	const { data: connectedSites } = useConnectedWpcomSites( ownerSite?.id );
	const liveSite = pickLiveSite( connectedSites ?? [] );
	const { mutate: setEnvironment } = useSetSessionEnvironment( sessionId ?? '' );
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
	const pendingPrompt = sessionId && handedOver?.sessionId === sessionId ? handedOver : null;
	// The empty state fades out under the first prompt, then unmounts.
	const showEmpty = isEmpty && ! pendingPrompt;
	const [ emptySessionId, setEmptySessionId ] = useState( showEmpty ? draftKey : null );
	if ( showEmpty && emptySessionId !== draftKey ) {
		setEmptySessionId( draftKey );
	}
	useEffect( () => {
		if ( showEmpty || emptySessionId === null ) return;
		const timeoutId = window.setTimeout(
			() => setEmptySessionId( null ),
			getMotionDuration( 'layout' )
		);
		return () => window.clearTimeout( timeoutId );
	}, [ showEmpty, emptySessionId ] );
	const isChatReady =
		( !! data || ( ! sessionId && !! ownerSite ) ) &&
		! isQuotaLoading &&
		! notice &&
		! isOutOfCredits;
	useEffect( () => {
		// Read the slot live rather than the rendered value: StrictMode runs the
		// effect twice for one render, and the second pass must find it empty.
		const prompt = pendingPromptSlot.getSnapshot();
		if ( ! sessionId || ! isChatReady || prompt?.sessionId !== sessionId ) return;
		pendingPromptSlot.clear( prompt );
		void sendMessage( prompt.prompt, prompt.attachments ).catch( () => {
			composerRef.current?.replaceDraft( prompt.prompt, prompt.attachments );
		} );
	}, [ isChatReady, pendingPrompt, sendMessage, sessionId ] );

	// Notes sent from the preview land in the composer, then go out with its
	// draft, or alone when they were sent directly. Direct sends join the queue
	// while the agent works.
	useEffect( () => {
		if ( ! isChatReady || ! annotationSiteId ) return;
		return subscribeAnnotationSend( annotationSiteId, ( { noteIds } ) => {
			stageAnnotations( annotationSiteId, noteIds );
			if ( composerBusy && ! noteIds ) return;
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
			<SessionFrame header={ hideHeader ? null : <div className={ styles.header } /> }>
				<div className={ styles.loadError } role="alert">
					<span>{ __( 'This chat could not load.' ) }</span>
					<Button variant="outline" onClick={ () => void refetch() }>
						{ __( 'Try again' ) }
					</Button>
				</div>
			</SessionFrame>
		);
	}

	if (
		( sessionId && ( isLoading || notFound || ! data ) ) ||
		( ! ownerSite && ! data ) ||
		isQuotaLoading
	) {
		// Use the same SessionFrame with an empty header and a structural
		// ComposerSkeleton so the scroll area has the exact same dimensions
		// as the loaded view — otherwise the empty-state dots jump
		// mid-transition.
		return (
			<SessionFrame
				header={ hideHeader ? null : <div className={ styles.header } /> }
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

	return (
		<SessionFrame
			session={ data?.summary }
			scrollRef={ setScrollNode }
			rootRef={ setFrameNode }
			header={
				hideHeader ? null : (
					<SessionHeader
						start={ headerStart }
						siteName={ data?.summary.ownerSiteName }
						site={ ownerSite }
						effectiveEnvironment={ effectiveEnvironment }
					/>
				)
			}
			composer={
				<div
					className={ clsx(
						styles.column,
						styles.composerColumn,
						! showEmpty && styles.composerBacking,
						fadeAfterQuotaCheck && styles.fadeInQuick
					) }
				>
					<QueuedPrompts
						prompts={ queuedPrompts }
						onRemove={ removeQueuedPrompt }
						onEdit={ reopenQueuedPrompt }
					/>
					<div className={ styles.scrollToLatestWrap }>
						<IconButton
							className={ styles.scrollToLatestButton }
							icon={ <ArrowDownIcon /> }
							label={ __( 'Jump to latest' ) }
							variant="outline"
							shape="round"
							data-visible={ isScrolledAway || undefined }
							inert={ ! isScrolledAway }
							onClick={ scrollToLatest }
						/>
					</div>
					<Composer
						ref={ composerRef }
						busy={ composerBusy }
						isInterrupting={ isInterrupting }
						model={ currentModel }
						onSend={ sendWithAutoStart }
						onAnswer={ targetQuestion ? answerTargetQuestion : undefined }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						draftKey={ draftKey }
						provider={ sessionProvider }
						onModelChange={
							sessionId ? undefined : ( model, provider ) => updateDraft( { model, provider } )
						}
						autoFocus={ isEmpty }
						entries={ data?.entries }
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ switchSession }
						placeholder={ composerPlaceholder }
						placeholderBusy={ isSiteStarting || isSiteStopping }
						canAutoStart={ canAutoStart }
						onStartSite={
							canAutoStart && ( ! ownerSite.running || isSiteStarting )
								? () => startSitePreview( ownerSite.id )
								: undefined
						}
						startSiteDisabled={ isSiteBusy }
						isSiteStarting={ isSiteStarting }
						environment={ effectiveEnvironment }
						onEnvironmentChange={
							ownerSite
								? ( environment ) =>
										sessionId
											? setEnvironment( environment )
											: updateDraft( {
													activeEnvironment: environment,
													lastSelectedWpcomSiteId: liveSite?.id,
											  } )
								: undefined
						}
						dropTarget={ frameNode }
						annotationSiteId={ annotationSiteId }
						notice={ notice }
					/>
				</div>
			}
		>
			{ emptySessionId === draftKey ? (
				<div className={ styles.emptyState } data-hidden={ ! showEmpty || undefined }>
					<PreviewParticles
						active={ siteLoading }
						showLogo={ siteLoading }
						selectionTime={ ownerSite?.running ? undefined : selectionTime }
					/>
					{ ownerSite && ! ownerSite.running && ! isSiteStarting ? (
						<StoppedSitePreview site={ ownerSite } />
					) : null }
				</div>
			) : null }
			<div data-chat-transcript className={ clsx( styles.column, styles.conversationSpacing ) }>
				{ data ? (
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
				) : null }
			</div>
			<div ref={ spacerRef } aria-hidden="true" />
		</SessionFrame>
	);
}
