import { resolveSessionModel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { Composer, ComposerSkeleton } from '@/components/session-view/composer';
import { pickLiveSite } from '@/components/session-view/composer/environment-pill';
import { Conversation } from '@/components/session-view/conversation';
import { EmptyBackground } from '@/components/session-view/empty-background';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import sessionStyles from '@/components/session-view/style.module.css';
import { useAgentRun } from '@/data/queries/use-agent-run';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useSession, useSessionEffectiveEnvironment } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSessionCommands } from '@/hooks/use-session-commands';
import { SessionUIProvider } from '@/hooks/use-session-ui';

interface DeskSessionSurfaceProps {
	sessionId: string;
	onSwitchSession: ( sessionId: string ) => void;
	autoFocus?: boolean;
}

interface FrameProps {
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	children?: ReactNode;
}

function Frame( { composer, scrollRef, children }: FrameProps ) {
	return (
		<div className={ sessionStyles.root }>
			<div className={ sessionStyles.chatColumn }>
				<div ref={ scrollRef } className={ sessionStyles.scroll }>
					{ children }
				</div>
				<div className={ sessionStyles.composerOuter }>{ composer }</div>
			</div>
		</div>
	);
}

function DeskSessionSurfaceContent( {
	sessionId,
	onSwitchSession,
	autoFocus = false,
}: DeskSessionSurfaceProps ) {
	const { data, isLoading, error } = useSession( sessionId );
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
					<div className={ sessionStyles.column }>
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
			scrollRef={ scrollRef }
			composer={
				<div className={ sessionStyles.column }>
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
						ownerSiteId={ ownerSite?.id }
						onSwitchSession={ onSwitchSession }
						autoFocus={ autoFocus }
					/>
				</div>
			}
		>
			{ isEmpty ? <EmptyBackground /> : null }
			<div className={ clsx( sessionStyles.column, sessionStyles.conversationSpacing ) }>
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

export function DeskSessionSurface( props: DeskSessionSurfaceProps ) {
	return (
		<SessionUIProvider>
			<DeskSessionSurfaceContent { ...props } />
		</SessionUIProvider>
	);
}
