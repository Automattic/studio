import { resolveSessionModel } from '@studio/common/ai/models';
import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import { QueryClientProvider } from '@tanstack/react-query';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { check, chevronDown, Icon as WpIcon } from '@wordpress/icons';
import { privateApis } from '@wordpress/theme';
import { Button as UiButton, Icon } from '@wordpress/ui';
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type Ref,
	type UIEvent,
} from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';
import { AccessRequirements } from './access-requirements';
import { clearSessionDraft, Composer, ComposerSkeleton } from './composer';
import { Conversation, wasLastTurnInterrupted } from './conversation';
import { unlock } from './lock-unlock';
import { queryClient } from './query-client';
import { QueuedPrompts } from './queued-prompts';
import { isScrolledToBottom } from './scroll-utils';
import { SiteCreatedDialog } from './site-created-dialog';
import { StudioCodeTabImage } from './studio-code-tab-image';
import styles from './style.module.css';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { useExamplePrompts } from './use-example-prompts';
import { useSession } from './use-session';
import { useSingleSession } from './use-single-session';
import { useSiteCreationSwitch } from './use-site-creation-switch';
import buttonDefense from './wp-ui-button-defense.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import '@wordpress/theme/design-tokens.css';

const { ThemeProvider } = unlock( privateApis );

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	onScroll?: ( event: UIEvent< HTMLDivElement > ) => void;
	scrollToBottomButton?: ReactNode;
	children?: ReactNode;
}

function SessionFrame( {
	header,
	composer,
	scrollRef,
	onScroll,
	scrollToBottomButton,
	children,
}: SessionFrameProps ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.chatColumn }>
				{ header }
				<div
					ref={ scrollRef }
					className={ cx( styles.scroll, styles.classicScroll ) }
					onScroll={ onScroll }
				>
					{ children }
				</div>
				<div className={ cx( styles.composerOuter, styles.classicComposerOuter ) }>
					{ scrollToBottomButton }
					{ composer }
				</div>
			</div>
		</div>
	);
}

function SessionLoadingFrame() {
	return (
		<SessionFrame
			header={ <div className={ styles.header } /> }
			composer={
				<div className={ styles.classicColumn }>
					<ComposerSkeleton />
				</div>
			}
		>
			<div className={ styles.loading } role="status" aria-live="polite">
				<Spinner className={ styles.loadingSpinner } />
			</div>
		</SessionFrame>
	);
}

function SessionHeader( { onNewConversation }: { onNewConversation: () => void } ) {
	return (
		<div className={ styles.header }>
			<span className={ styles.headerSpacer } aria-hidden="true" />
			<div className={ styles.headerActions }>
				<UiButton
					variant="minimal"
					tone="neutral"
					size="small"
					className={ buttonDefense.button }
					onClick={ onNewConversation }
				>
					{ __( 'New conversation' ) }
				</UiButton>
			</div>
		</div>
	);
}

function NoAuth() {
	const isOffline = useOffline();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4 overflow-hidden">
			<div className="flex flex-col">
				<div className="a8c-subtitle mb-1">{ __( 'Build with Studio Code' ) }</div>
				<div className="w-[40ch] text-frame-text-secondary a8c-body">
					{ __(
						'Your AI coding agent for WordPress. Describe what you want and Studio Code builds, edits, and debugs your site.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Create and edit themes, plugins, and content.' ),
						__( 'Debug issues and run WP-CLI commands.' ),
						__( 'Build with built-in feedback loops and agent skills.' ),
					].map( ( text ) => (
						<div key={ text } className="text-frame-text-secondary a8c-body flex items-center">
							<WpIcon className="fill-frame-theme ltr:mr-2 rtl:ml-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				<div className="mt-8">
					<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							variant="primary"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								authenticate();
							} }
						>
							{ __( 'Log in to WordPress.com' ) }
							<ArrowIcon />
						</Button>
					</Tooltip>
				</div>
				<div className="mt-3 w-[40ch] text-frame-text-secondary a8c-body">
					<Tooltip
						disabled={ ! isOffline }
						icon={ offlineIcon }
						text={ offlineMessage }
						placement="bottom-start"
					>
						<span>
							{ __( 'A WordPress.com account is required to use Studio Code.' ) }{ ' ' }
							<Button
								aria-description={ isOffline ? offlineMessage : '' }
								aria-disabled={ isOffline }
								className="!p-0 text-frame-theme hover:opacity-80 h-auto inline-flex items-center"
								onClick={ () => {
									if ( isOffline ) {
										return;
									}
									getIpcApi().authenticate( true );
								} }
							>
								{ __( 'Create a free account' ) }
								<ArrowIcon />
							</Button>
						</span>
					</Tooltip>
				</div>
			</div>
			<IllustrationGrid>
				<StudioCodeTabImage />
			</IllustrationGrid>
		</div>
	);
}

function hasVisibleUserPrompt( entries: SessionEntry[] ): boolean {
	return entries.some( ( entry ) => {
		if ( ! isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			return false;
		}
		const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
		return data?.source === 'prompt';
	} );
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
	const examplePrompts = useExamplePrompts();

	return (
		<div className={ styles.emptyConversation }>
			<div className={ styles.emptyConversationPrompt }>
				{ __( 'Ask Studio Code anything to get started.' ) }
			</div>
			<div className={ styles.emptyConversationExamples }>
				{ examplePrompts.map( ( example ) => (
					<button
						key={ example.id }
						type="button"
						className={ styles.emptyConversationExample }
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
					</button>
				) ) }
			</div>
		</div>
	);
}

function SessionContent( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { sessionId, setSessionId, newSession } = useSingleSession( selectedSite.id );
	const { data, isLoading } = useSession( sessionId );
	const startNewChat = useCallback( () => void newSession(), [ newSession ] );
	const {
		pending: pendingSiteCreation,
		openNewSite,
		stayHere,
	} = useSiteCreationSwitch( {
		sessionId,
		currentSiteId: selectedSite.id,
		onStartNewChat: startNewChat,
	} );
	const {
		isRunning,
		hasActiveRun,
		isInterrupting,
		startedAt,
		error: runError,
		usageCapReached,
		pendingQuestions,
		pendingAnswers,
		answeredQuestions,
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
	const canEditLastUserMessage = useMemo(
		() => ! composerBusy && ! isRunning && wasLastTurnInterrupted( data?.entries ?? [] ),
		[ composerBusy, isRunning, data?.entries ]
	);
	const editAndResendMessage = useCallback(
		async ( entryId: string, newText: string ) => {
			if ( ! sessionId ) return;
			await getIpcApi().markAiMessageEdited( sessionId, entryId );
			await sendMessage( newText );
		},
		[ sessionId, sendMessage ]
	);
	const scrollRef = useRef< HTMLDivElement >( null );
	// Whether new content should keep the view pinned to the bottom. Disabled
	// when the user scrolls up to read history, re-enabled when they return.
	const [ stickToBottom, setStickToBottom ] = useState( true );
	// Set while the effect drives `scrollTop` programmatically so the resulting
	// scroll event doesn't get mistaken for the user scrolling up.
	const isProgrammaticScroll = useRef( false );

	const [ promptDraft, setPromptDraft ] = useState< { id: number; prompt: string } | null >( null );
	const [ previewPrompt, setPreviewPrompt ] = useState< string | null >( null );
	const draftIdRef = useRef( 0 );
	const selectPrompt = useCallback( ( prompt: string ) => {
		draftIdRef.current += 1;
		setPromptDraft( { id: draftIdRef.current, prompt } );
	}, [] );
	const clearPreview = useCallback( () => setPreviewPrompt( null ), [] );

	const showEmptyConversation =
		! hasActiveRun && queuedPrompts.length === 0 && ! hasVisibleUserPrompt( data?.entries ?? [] );

	const scrollToBottom = useCallback( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		isProgrammaticScroll.current = true;
		node.scrollTop = node.scrollHeight;
	}, [] );

	const handleScroll = useCallback( ( event: UIEvent< HTMLDivElement > ) => {
		if ( isProgrammaticScroll.current ) {
			return;
		}
		setStickToBottom( isScrolledToBottom( event.currentTarget ) );
	}, [] );

	const handleScrollToBottomClick = useCallback( () => {
		scrollToBottom();
		setStickToBottom( true );
	}, [ scrollToBottom ] );

	const handleNewConversation = useCallback( () => {
		clearSessionDraft( sessionId );
		selectPrompt( '' );
		void newSession();
	}, [ newSession, sessionId, selectPrompt ] );

	// A fresh session starts pinned to the bottom.
	useLayoutEffect( () => {
		setStickToBottom( true );
	}, [ sessionId ] );

	useLayoutEffect( () => {
		const node = scrollRef.current;
		if ( ! node || ! stickToBottom ) {
			return;
		}
		isProgrammaticScroll.current = true;
		node.scrollTop = node.scrollHeight;
		const id = requestAnimationFrame( () => {
			node.scrollTop = node.scrollHeight;
			isProgrammaticScroll.current = false;
		} );
		return () => cancelAnimationFrame( id );
	}, [ sessionId, data, isRunning, queuedPrompts.length, stickToBottom ] );

	// The dialog renders alongside every body state below, not just the loaded
	// one. Creating the migrated site's fresh chat flips this tab back into its
	// loading state briefly; keeping the dialog mounted across that avoids it
	// disappearing and reappearing mid-prompt.
	let body: ReactNode;
	if ( ! sessionId || isLoading ) {
		body = <SessionLoadingFrame />;
	} else if ( ! data ) {
		body = (
			<div className="p-8 flex flex-col max-w-3xl">
				<div className="a8c-subtitle mb-1">{ __( 'Session not found' ) }</div>
				<div className="w-[40ch] text-frame-text-secondary a8c-body">
					{ __(
						'This conversation is no longer available. Start a new one to keep building with Studio Code.'
					) }
				</div>
				<div className="mt-6">
					<Button variant="primary" onClick={ handleNewConversation }>
						{ __( 'Start a new conversation' ) }
					</Button>
				</div>
			</div>
		);
	} else {
		body = (
			<SessionFrame
				scrollRef={ scrollRef }
				onScroll={ handleScroll }
				header={ <SessionHeader onNewConversation={ handleNewConversation } /> }
				scrollToBottomButton={
					! stickToBottom && (
						<div className={ styles.scrollToBottom }>
							<UiButton
								variant="outline"
								tone="neutral"
								size="small"
								className={ buttonDefense.button }
								aria-label={ __( 'Scroll to bottom' ) }
								onClick={ handleScrollToBottomClick }
							>
								<Icon icon={ chevronDown } size={ 18 } />
							</UiButton>
						</div>
					)
				}
				composer={
					<div className={ styles.classicColumn }>
						<QueuedPrompts prompts={ queuedPrompts } onRemove={ removeQueuedPrompt } />
						<Composer
							busy={ composerBusy }
							isInterrupting={ isInterrupting }
							error={ usageCapReached ? null : runError }
							usageCapMessage={ usageCapReached ? runError : null }
							model={ currentModel }
							onSend={ sendMessage }
							onInterrupt={ interrupt }
							sessionId={ sessionId }
							entries={ data.entries }
							ownerSiteId={ selectedSite.id }
							onSwitchSession={ setSessionId }
							draftPrompt={ promptDraft }
							previewPrompt={ previewPrompt }
						/>
					</div>
				}
			>
				<div className={ cx( styles.classicColumn, styles.classicConversationSpacing ) }>
					{ showEmptyConversation ? (
						<EmptyConversation
							onPreviewPrompt={ setPreviewPrompt }
							onClearPreview={ clearPreview }
							onSelectPrompt={ selectPrompt }
						/>
					) : (
						<Conversation
							data={ data }
							isRunning={ isRunning }
							startedAt={ startedAt }
							pendingQuestions={ pendingQuestionTexts }
							pendingAnswers={ pendingAnswers }
							answeredQuestions={ answeredQuestions }
							onAnswerQuestion={ answerQuestion }
							canEditLastUserMessage={ canEditLastUserMessage }
							onEditUserMessage={ editAndResendMessage }
						/>
					) }
				</div>
			</SessionFrame>
		);
	}

	return (
		<>
			{ body }
			<SiteCreatedDialog
				pending={ pendingSiteCreation }
				onOpenNewSite={ openNewSite }
				onStayHere={ stayHere }
			/>
		</>
	);
}

function SessionGate( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { isAuthenticated } = useAuth();
	const {
		data: quota,
		isLoading: isQuotaLoading,
		isFetching: isQuotaFetching,
		refetch: refetchQuota,
	} = useGetStudioAssistantQuota( undefined, { skip: ! isAuthenticated } );

	if ( ! isAuthenticated ) {
		return <NoAuth />;
	}

	if ( isQuotaLoading ) {
		return <SessionLoadingFrame />;
	}

	// Fail open when the quota is unavailable (offline, error, older server) —
	// the WordPress.com proxy enforces the same gate server-side.
	if ( quota && ! quota.hasPaymentMethod ) {
		return <AccessRequirements isRechecking={ isQuotaFetching } onRecheck={ refetchQuota } />;
	}

	return <SessionContent selectedSite={ selectedSite } />;
}

export function StudioCodeSession( { selectedSite }: { selectedSite: SiteDetails } ) {
	return (
		<QueryClientProvider client={ queryClient }>
			<ThemeProvider density="compact">
				<AgentRunProvider>
					<SessionGate selectedSite={ selectedSite } />
				</AgentRunProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
