import { resolveSessionModel } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Composer } from '@/components/session-view/composer';
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

export function SessionView( { sessionId }: { sessionId: string } ) {
	const { data, isLoading, error } = useSession( sessionId );
	const connector = useConnector();
	const queryClient = useQueryClient();
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
	// Optimistically append a `session.model_selected` event so the composer
	// reflects the new pick immediately. The main process writes the same event
	// to the JSONL; if that write fails we fall back to the prior state.
	const onModelChange = useCallback(
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
		return (
			<div className={ clsx( styles.state, styles.loadingState ) }>
				<div className={ styles.loadingAnimation }>
					<EmptyBackground />
				</div>
				<div className={ styles.loadingLabel }>{ __( 'Loading…' ) }</div>
			</div>
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
		<div className={ styles.root }>
			<div className={ styles.chatColumn }>
				<SessionHeader
					summary={ data.summary }
					previewOpen={ showPreview }
					onTogglePreview={ () => setPreviewOpen( ( open ) => ! open ) }
					canTogglePreview={ canTogglePreview }
				/>
				<div ref={ scrollRef } className={ styles.scroll }>
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
				</div>
				<div className={ styles.composerOuter }>
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
				</div>
			</div>
			{ showPreview && ownerSite ? (
				<SitePreview site={ ownerSite } sessionId={ sessionId } />
			) : null }
		</div>
	);
}
