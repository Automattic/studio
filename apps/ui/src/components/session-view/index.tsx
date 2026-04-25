import { AI_MODELS, getAiModelFamily, resolveSessionModel } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type Ref,
} from 'react';
import { Composer, ComposerSkeleton } from '@/components/session-view/composer';
import { pickLiveSite } from '@/components/session-view/composer/environment-pill';
import { Conversation } from '@/components/session-view/conversation';
import { EmptyBackground } from '@/components/session-view/empty-background';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import { SiteDropdown } from '@/components/site-dropdown';
import { SitePreview } from '@/components/site-preview';
import { useConnector } from '@/data/core';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	SESSIONS_QUERY_KEY,
	useSession,
	useSessionEffectiveEnvironment,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { AiModelId, AiSessionSummary, LoadedAiSession } from '@/data/core';

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
				<SiteDropdown site={ site } activeEnvironment={ effectiveEnvironment } />
			) : (
				<>
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
	preview?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

function SessionFrame( { header, composer, preview, scrollRef, children }: SessionFrameProps ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.chatColumn }>
				{ header }
				<div ref={ scrollRef } className={ styles.scroll }>
					{ children }
				</div>
				<div className={ styles.composerOuter }>{ composer }</div>
			</div>
			{ preview }
		</div>
	);
}

export function SessionView( { sessionId }: { sessionId: string } ) {
	const { data, isLoading, error } = useSession( sessionId );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
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
	const currentModel = useMemo( () => resolveSessionModel( data?.events ?? [] ), [ data?.events ] );
	// Cross-family switches need a fresh session: the runtimes don't share a
	// transcript, so continuing the same JSONL with a different family makes
	// the on-screen history disagree with the agent's actual memory. We hold
	// the user's pick here and surface a confirmation dialog before acting.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	// Same-family switch: optimistically append a `session.model_selected` event
	// so the composer reflects the new pick immediately. The main process writes
	// the same event to the JSONL; if that write fails we fall back to the
	// prior state.
	const applySameFamilyModel = useCallback(
		( model: AiModelId ) => {
			const timestamp = new Date().toISOString();
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) =>
					prev
						? {
								...prev,
								events: [ ...prev.events, { type: 'session.model_selected', timestamp, model } ],
						  }
						: prev
			);
			void connector.setSessionModel( sessionId, model ).catch( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
				} );
			} );
		},
		[ connector, queryClient, sessionId ]
	);

	const onModelChange = useCallback(
		( model: AiModelId ) => {
			if ( model === currentModel ) {
				return;
			}
			// Cross-family switch: defer until the user confirms in the dialog —
			// the runtimes don't share a transcript, so continuing the same JSONL
			// across families would make the on-screen history disagree with the
			// agent's actual memory. We skip the prompt when:
			//   - the session has no user turns yet (nothing to lose), or
			//   - the session has no local owner site (we have no `siteId` to pass
			//     to `createSession`, so the fresh-session path can't run; fall
			//     back to the in-place switch instead of blocking the dropdown).
			const hasTurns = ( data?.events ?? [] ).some( ( event ) => event.type === 'user.message' );
			if (
				getAiModelFamily( currentModel ) !== getAiModelFamily( model ) &&
				ownerSite &&
				hasTurns
			) {
				setPendingFamilyChange( model );
				return;
			}
			applySameFamilyModel( model );
		},
		[ applySameFamilyModel, currentModel, data?.events, ownerSite ]
	);

	const cancelFamilyChange = useCallback( () => {
		if ( familySwitchInFlight ) {
			return;
		}
		setPendingFamilyChange( null );
	}, [ familySwitchInFlight ] );

	const confirmFamilyChange = useCallback( async () => {
		if ( ! pendingFamilyChange || ! ownerSite ) {
			return;
		}
		setFamilySwitchInFlight( true );
		try {
			const newSession = await connector.createSession( ownerSite.id );
			// Persist the model on the fresh session before navigating so the
			// composer there opens already on the picked family — `setSessionModel`
			// writes a `session.model_selected` event the new view picks up via
			// `resolveSessionModel`. If this fails we still navigate; the user
			// can re-pick from the new view's dropdown.
			await connector
				.setSessionModel( newSession.id, pendingFamilyChange )
				.catch( () => undefined );
			void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			setPendingFamilyChange( null );
			void navigate( { to: '/sessions/$sessionId', params: { sessionId: newSession.id } } );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, navigate, ownerSite, pendingFamilyChange, queryClient ] );
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( q ) => q.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	const isEmpty = useMemo(
		() => ! ( data?.events ?? [] ).some( ( event ) => event.type === 'user.message' ),
		[ data?.events ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	const [ previewOpen, setPreviewOpen ] = useState( false );
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const showPreview = previewOpen && canTogglePreview;

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
					<div className={ styles.column }>
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
		<>
			<SessionFrame
				scrollRef={ scrollRef }
				header={
					<SessionHeader
						summary={ data.summary }
						previewOpen={ showPreview }
						onTogglePreview={ () => setPreviewOpen( ( open ) => ! open ) }
						canTogglePreview={ canTogglePreview }
					/>
				}
				composer={
					<div className={ styles.column }>
						<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
						<Composer
							busy={ composerBusy }
							isInterrupting={ isInterrupting }
							error={ runError }
							model={ currentModel }
							onModelChange={ onModelChange }
							onSend={ sendMessage }
							onInterrupt={ interrupt }
							sessionId={ sessionId }
							effectiveEnvironment={ effectiveEnvironment }
							liveSite={ liveSite }
						/>
					</div>
				}
				preview={
					showPreview && ownerSite ? (
						<SitePreview site={ ownerSite } sessionId={ sessionId } />
					) : null
				}
			>
				{ isEmpty ? <EmptyBackground /> : null }
				<div className={ clsx( styles.column, styles.conversationSpacing ) }>
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
			<FamilySwitchConfirmDialog
				currentModel={ currentModel }
				pendingModel={ pendingFamilyChange }
				inFlight={ familySwitchInFlight }
				onCancel={ cancelFamilyChange }
				onConfirm={ () => void confirmFamilyChange() }
			/>
		</>
	);
}

function FamilySwitchConfirmDialog( {
	currentModel,
	pendingModel,
	inFlight,
	onCancel,
	onConfirm,
}: {
	currentModel: AiModelId;
	pendingModel: AiModelId | null;
	inFlight: boolean;
	onCancel: () => void;
	onConfirm: () => void;
} ) {
	return (
		<Dialog.Root
			open={ pendingModel !== null }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onCancel();
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Start a new conversation?' ) }</Dialog.Title>
				</Dialog.Header>
				<p>
					{ pendingModel
						? sprintf(
								/* translators: 1: current model name, 2: new model name */
								__(
									'Switching from %1$s to %2$s starts a fresh conversation — the two model families don\u2019t share memory. Your current chat stays in the sidebar.'
								),
								AI_MODELS[ currentModel ],
								AI_MODELS[ pendingModel ]
						  )
						: '' }
				</p>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ inFlight }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ inFlight }
						loadingAnnouncement={ __( 'Starting new conversation' ) }
						onClick={ onConfirm }
					>
						{ __( 'Start new conversation' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
