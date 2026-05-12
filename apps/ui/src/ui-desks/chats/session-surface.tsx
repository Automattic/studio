import { resolveSessionModel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { __ } from '@wordpress/i18n';
import { box, chevronLeft, chevronRight, previous, starEmpty, starFilled } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { Composer, ComposerSkeleton } from '@/components/session-view/composer';
import { pickLiveSite } from '@/components/session-view/composer/environment-pill';
import { Conversation } from '@/components/session-view/conversation';
import { EmptyBackground } from '@/components/session-view/empty-background';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import sessionStyles from '@/components/session-view/style.module.css';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useSession,
	useSessionEffectiveEnvironment,
	useUpdateSessionMetadata,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider } from '@/hooks/use-session-ui';
import styles from './style.module.css';
import type { PendingChatPrompt } from './context';

interface SessionSurfaceProps {
	siteId?: string;
	sessionId: string;
	side: 'left' | 'right';
	listCollapsed: boolean;
	onExpandList: () => void;
	onCollapseList: () => void;
	onSwitchSession: ( sessionId: string ) => void;
	autoFocus?: boolean;
	initialPrompt?: PendingChatPrompt;
	onInitialPromptConsumed?: ( promptId: string ) => void;
}

interface FrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

const chatDateFormatter = new Intl.DateTimeFormat( undefined, {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
} );

function formatChatDate( value: string ) {
	const timestamp = Date.parse( value );
	if ( Number.isNaN( timestamp ) ) {
		return '';
	}
	return chatDateFormatter.format( new Date( timestamp ) );
}

function Frame( { header, composer, scrollRef, children }: FrameProps ) {
	return (
		<div className={ clsx( sessionStyles.root, styles.sessionSurface ) }>
			<div className={ sessionStyles.chatColumn }>
				{ header }
				<div ref={ scrollRef } className={ sessionStyles.scroll }>
					{ children }
				</div>
				<div className={ sessionStyles.composerOuter }>{ composer }</div>
			</div>
		</div>
	);
}

function SessionSurfaceContent( {
	siteId,
	sessionId,
	side,
	listCollapsed,
	onExpandList,
	onCollapseList,
	onSwitchSession,
	autoFocus = false,
	initialPrompt,
	onInitialPromptConsumed,
}: SessionSurfaceProps ) {
	const { data, isLoading, error } = useSession( sessionId );
	const { data: sites } = useSites();
	const ownerSitePath = data?.summary.ownerSitePath;
	const ownerSite = ownerSitePath
		? sites?.find( ( candidate ) => candidate.path === ownerSitePath )
		: undefined;
	const ownerSiteId = ownerSite?.id ?? siteId;
	const { data: connectedSites } = useConnectedWpcomSites( ownerSiteId );
	const liveSite = pickLiveSite( connectedSites );
	const effectiveEnvironment = useSessionEffectiveEnvironment( data?.summary, ownerSiteId );
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
	const sentInitialPromptIdsRef = useRef< Set< string > >( new Set() );
	const updateSessionMetadata = useUpdateSessionMetadata();
	const currentModel = useMemo(
		() => resolveSessionModel( data?.entries ?? [] ),
		[ data?.entries ]
	);
	const pendingQuestionTexts = useMemo(
		() => new Set( pendingQuestions.map( ( question ) => question.question ) ),
		[ pendingQuestions ]
	);
	const composerBusy = hasActiveRun || pendingQuestions.length > 0;
	const isEmpty = useMemo(
		() =>
			! ( data?.entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			),
		[ data?.entries ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	useSessionCommands( sessionId );

	const toggleStar = () => {
		void updateSessionMetadata.mutateAsync( {
			sessionId,
			patch: { starred: ! data?.summary.starred },
		} );
	};

	const archiveConversation = () => {
		void updateSessionMetadata.mutateAsync( {
			sessionId,
			patch: { archived: true },
		} );
	};

	useEffect( () => {
		if ( ! data || ! initialPrompt || initialPrompt.sessionId !== sessionId ) {
			return;
		}
		if ( sentInitialPromptIdsRef.current.has( initialPrompt.id ) ) {
			return;
		}

		sentInitialPromptIdsRef.current.add( initialPrompt.id );
		void sendMessage( initialPrompt.prompt, {
			displayMessage: initialPrompt.displayMessage,
		} )
			.then( () => onInitialPromptConsumed?.( initialPrompt.id ) )
			.catch( () => {
				sentInitialPromptIdsRef.current.delete( initialPrompt.id );
			} );
	}, [ data, initialPrompt, onInitialPromptConsumed, sendMessage, sessionId ] );

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
		return (
			<Frame
				composer={
					<div>
						<ComposerSkeleton />
					</div>
				}
			>
				<EmptyBackground />
			</Frame>
		);
	}

	if ( error || ! data ) {
		return (
			<div className={ sessionStyles.state }>
				<h1>{ __( 'Session not found' ) }</h1>
				<p>{ sessionId }</p>
			</div>
		);
	}

	return (
		<Frame
			header={
				<div className={ styles.conversationHeader }>
					<div className={ styles.conversationHeaderSlot }>
						{ listCollapsed ? (
							<button
								type="button"
								className={ styles.conversationBackButton }
								onClick={ onExpandList }
							>
								<Icon icon={ side === 'left' ? chevronLeft : chevronRight } size={ 18 } />
								<span>{ __( 'All chats' ) }</span>
							</button>
						) : (
							<button
								type="button"
								className={ styles.conversationCollapseButton }
								aria-label={ __( 'Collapse list' ) }
								title={ __( 'Collapse list' ) }
								onClick={ onCollapseList }
							>
								<Icon icon={ previous } size={ 20 } />
							</button>
						) }
					</div>
					<span className={ styles.conversationDate }>
						{ formatChatDate( data.summary.createdAt ) }
					</span>
					<div className={ styles.conversationActions }>
						<button
							type="button"
							className={ styles.conversationAction }
							aria-label={ __( 'Archive conversation' ) }
							title={ __( 'Archive conversation' ) }
							disabled={ updateSessionMetadata.isPending }
							onClick={ archiveConversation }
						>
							<Icon icon={ box } size={ 20 } />
						</button>
						<button
							type="button"
							className={ styles.conversationAction }
							data-active={ data.summary.starred ? 'true' : 'false' }
							aria-label={
								data.summary.starred ? __( 'Unstar conversation' ) : __( 'Star conversation' )
							}
							title={
								data.summary.starred ? __( 'Unstar conversation' ) : __( 'Star conversation' )
							}
							disabled={ updateSessionMetadata.isPending }
							onClick={ toggleStar }
						>
							<Icon icon={ data.summary.starred ? starFilled : starEmpty } size={ 20 } />
						</button>
					</div>
				</div>
			}
			scrollRef={ scrollRef }
			composer={
				<div>
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
						ownerSiteId={ ownerSiteId }
						onSwitchSession={ onSwitchSession }
						autoFocus={ autoFocus }
					/>
				</div>
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div>
				<Conversation
					data={ data }
					isRunning={ isRunning }
					startedAt={ startedAt }
					pendingQuestions={ pendingQuestionTexts }
					pendingAnswers={ pendingAnswers }
					onAnswerQuestion={ answerQuestion }
				/>
			</div>
		</Frame>
	);
}

export function SessionSurface( props: SessionSurfaceProps ) {
	return (
		<SessionUIProvider>
			<SessionSurfaceContent { ...props } />
		</SessionUIProvider>
	);
}
