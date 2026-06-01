import { resolveSessionModel } from '@studio/common/ai/models';
import { QueryClientProvider } from '@tanstack/react-query';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { chevronDown } from '@wordpress/icons';
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
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Composer, ComposerSkeleton } from './composer';
import { Conversation } from './conversation';
import { unlock } from './lock-unlock';
import { queryClient } from './query-client';
import { QueuedPrompts } from './queued-prompts';
import { isScrolledToBottom } from './scroll-utils';
import styles from './style.module.css';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { useSession } from './use-session';
import { useSingleSession } from './use-single-session';
import buttonDefense from './wp-ui-button-defense.module.css';
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
	// Whether new content should keep the view pinned to the bottom. Disabled
	// when the user scrolls up to read history, re-enabled when they return.
	const [ stickToBottom, setStickToBottom ] = useState( true );
	// Set while the effect drives `scrollTop` programmatically so the resulting
	// scroll event doesn't get mistaken for the user scrolling up.
	const isProgrammaticScroll = useRef( false );

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

	if ( ! sessionId || isLoading ) {
		return (
			<SessionFrame
				header={ <div className={ styles.header } /> }
				composer={
					<div className={ styles.classicColumn }>
						<ComposerSkeleton />
					</div>
				}
			/>
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
			onScroll={ handleScroll }
			header={ <SessionHeader onNewConversation={ () => void newSession() } /> }
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
						error={ runError }
						model={ currentModel }
						onSend={ sendMessage }
						onInterrupt={ interrupt }
						sessionId={ sessionId }
						entries={ data.entries }
						ownerSiteId={ selectedSite.id }
						onSwitchSession={ setSessionId }
					/>
				</div>
			}
		>
			<div className={ cx( styles.classicColumn, styles.classicConversationSpacing ) }>
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
