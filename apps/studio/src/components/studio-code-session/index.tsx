import { resolveSessionModel } from '@studio/common/ai/models';
import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import { QueryClientProvider } from '@tanstack/react-query';
import { Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button as UiButton } from '@wordpress/ui';
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type Ref,
} from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Composer, ComposerSkeleton } from './composer';
import { Conversation } from './conversation';
import { unlock } from './lock-unlock';
import { queryClient } from './query-client';
import { QueuedPrompts } from './queued-prompts';
import styles from './style.module.css';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { useExamplePrompts } from './use-example-prompts';
import { useSession } from './use-session';
import { useSingleSession } from './use-single-session';
import buttonDefense from './wp-ui-button-defense.module.css';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import '@wordpress/theme/design-tokens.css';

const { ThemeProvider } = unlock( privateApis );

interface SessionFrameProps {
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

function SessionFrame( { header, composer, scrollRef, children }: SessionFrameProps ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.chatColumn }>
				{ header }
				<div ref={ scrollRef } className={ cx( styles.scroll, styles.classicScroll ) }>
					{ children }
				</div>
				<div className={ cx( styles.composerOuter, styles.classicComposerOuter ) }>
					{ composer }
				</div>
			</div>
		</div>
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

function UnauthenticatedNotice( { onAuthenticate }: { onAuthenticate: () => void } ) {
	return (
		<div className="px-4 pb-4">
			<div className="p-3 rounded border border-frame-border bg-frame/45">
				<div className="mb-3 a8c-label-semibold">{ __( 'Hold up!' ) }</div>
				<div className="mb-1">
					{ __( 'You need to log in to your WordPress.com account to use Studio Code.' ) }
				</div>
				<div className="mb-3">
					{ createInterpolateElement(
						__( "If you don't have an account yet, <a>create one for free</a>." ),
						{
							a: <Button variant="link" onClick={ () => getIpcApi().authenticate( true ) } />,
						}
					) }
				</div>
				<Button variant="primary" onClick={ onAuthenticate }>
					{ __( 'Log in to WordPress.com' ) }
					<ArrowIcon />
				</Button>
			</div>
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
	const scrollRef = useRef< HTMLDivElement >( null );

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

	if ( ! sessionId || isLoading ) {
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

	if ( ! data ) {
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
			header={ <SessionHeader onNewConversation={ () => void newSession() } /> }
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
						onAnswerQuestion={ answerQuestion }
					/>
				) }
			</div>
		</SessionFrame>
	);
}

function SessionGate( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();

	if ( ! isAuthenticated && ! isOffline ) {
		return <UnauthenticatedNotice onAuthenticate={ authenticate } />;
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
