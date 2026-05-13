import { resolveSessionModel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { __ } from '@wordpress/i18n';
import { box, chevronLeft, chevronRight, previous, starEmpty, starFilled } from '@wordpress/icons';
import { clsx } from 'clsx';
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type Ref,
} from 'react';
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
import { Button } from '@/ui-desks/components';
import { Composer, ComposerSkeleton } from '../composer';
import { pickLiveSite } from '../composer/environment-pill';
import { Conversation } from '../conversation';
import { EmptyBackground } from '../empty-background';
import { QueuedPrompts } from '../queued-prompts';
import styles from './style.module.css';
import type { PendingChatPrompt } from '../context';

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

const EXAMPLE_PROMPTS = [
	{
		short: __( 'Pull drafts' ),
		full: __(
			'Pull my unfinished drafts onto the canvas so I can see what I’ve been working on. Group anything related into stacks, and surface the ones I haven’t touched in a while.'
		),
	},
	{
		short: __( 'Draft a post' ),
		full: __(
			'Help me draft a new blog post. Suggest a topic worth writing about right now, sketch an outline, then take a first pass at the opening paragraph so I can iterate on voice and structure.'
		),
	},
	{
		short: __( 'Create a page' ),
		full: __(
			'Walk me through creating a new page on my site. Help me plan the sections, draft the headings, and write a first pass at the body copy — then drop the result onto the canvas so I can edit it.'
		),
	},
	{
		short: __( 'Design help' ),
		full: __(
			'Take a look at my site’s current design and call out a handful of small improvements I could make — typography, spacing, colour, or layout — and explain why each change would help.'
		),
	},
	{
		short: __( 'Top posts' ),
		full: __(
			'Pull my most-viewed posts from the last 30 days onto the canvas so I can see them side by side. Sort by view count and group anything that shares a topic into a stack.'
		),
	},
	{
		short: __( 'Write follow-up' ),
		full: __(
			'Suggest a follow-up to my most recent post. Read what I wrote, find a natural next angle, then sketch an outline and draft an opening paragraph so I can pick up where it left off.'
		),
	},
	{
		short: __( 'Build a plugin' ),
		full: __(
			'Help me build a small WordPress plugin from scratch. Ask me what problem it should solve, scaffold the plugin folder and main file, then walk me through the hooks and code we need to wire it up.'
		),
	},
];

function formatChatDate( value: string ) {
	const timestamp = Date.parse( value );
	if ( Number.isNaN( timestamp ) ) {
		return '';
	}
	return chatDateFormatter.format( new Date( timestamp ) );
}

function EmptyConversation( {
	onPreviewPrompt,
	onClearPreview,
	onSelectPrompt,
}: {
	onPreviewPrompt: ( prompt: string ) => void;
	onClearPreview: () => void;
	onSelectPrompt: ( prompt: string ) => void;
} ) {
	return (
		<div className={ styles.emptyConversation }>
			<div className={ styles.emptyConversationPrompt }>
				{ __( 'Ask Studio Desk anything to get started.' ) }
			</div>
			<div className={ styles.emptyConversationExamples }>
				{ EXAMPLE_PROMPTS.map( ( example ) => (
					<Button
						key={ example.short }
						variant="quiet"
						size="small"
						className={ styles.emptyConversationExample }
						label={ example.short }
						title={ example.full }
						onMouseEnter={ () => onPreviewPrompt( example.full ) }
						onMouseLeave={ onClearPreview }
						onFocus={ () => onPreviewPrompt( example.full ) }
						onBlur={ onClearPreview }
						onClick={ () => {
							onSelectPrompt( example.full );
							onClearPreview();
						} }
					>
						{ example.short }
					</Button>
				) ) }
			</div>
		</div>
	);
}

function Frame( { header, composer, scrollRef, children }: FrameProps ) {
	return (
		<div className={ clsx( styles.root, styles.sessionSurface ) }>
			<div className={ styles.chatColumn }>
				{ header }
				<div ref={ scrollRef } className={ styles.scroll }>
					{ children }
				</div>
				<div className={ styles.composerOuter }>{ composer }</div>
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
	const exampleDraftIdRef = useRef( 0 );
	const [ previewPrompt, setPreviewPrompt ] = useState< string | null >( null );
	const [ exampleDraft, setExampleDraft ] = useState< { id: number; prompt: string } | null >(
		null
	);
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
			<div className={ styles.state }>
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
							<Button
								variant="quiet"
								size="small"
								className={ styles.conversationBackButton }
								icon={ side === 'left' ? chevronLeft : chevronRight }
								label={ __( 'All chats' ) }
								tooltipLabel={ false }
								onClick={ onExpandList }
							>
								<span>{ __( 'All chats' ) }</span>
							</Button>
						) : (
							<Button
								variant="quiet"
								size="small"
								className={ styles.conversationCollapseButton }
								icon={ previous }
								label={ __( 'Collapse list' ) }
								onClick={ onCollapseList }
							/>
						) }
					</div>
					<span className={ styles.conversationDate }>
						{ formatChatDate( data.summary.createdAt ) }
					</span>
					<div className={ styles.conversationActions }>
						<Button
							variant="quiet"
							size="small"
							className={ styles.conversationAction }
							icon={ box }
							label={ __( 'Archive conversation' ) }
							disabled={ updateSessionMetadata.isPending }
							onClick={ archiveConversation }
						/>
						<Button
							variant="quiet"
							size="small"
							className={ styles.conversationAction }
							data-active={ data.summary.starred ? 'true' : 'false' }
							icon={ data.summary.starred ? starFilled : starEmpty }
							label={
								data.summary.starred ? __( 'Unstar conversation' ) : __( 'Star conversation' )
							}
							disabled={ updateSessionMetadata.isPending }
							onClick={ toggleStar }
						/>
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
						previewPrompt={ previewPrompt }
						draftPrompt={ exampleDraft }
					/>
				</div>
			}
		>
			{ isEmpty ? (
				<EmptyConversation
					onPreviewPrompt={ setPreviewPrompt }
					onClearPreview={ () => setPreviewPrompt( null ) }
					onSelectPrompt={ ( prompt ) => {
						exampleDraftIdRef.current += 1;
						setExampleDraft( { id: exampleDraftIdRef.current, prompt } );
					} }
				/>
			) : null }
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
