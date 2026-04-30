import { resolveSessionModel } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
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
import {
	Composer,
	ComposerSkeleton,
	type ComposerHandle,
} from '@/components/session-view/composer';
import { pickLiveSite } from '@/components/session-view/composer/environment-pill';
import { Conversation } from '@/components/session-view/conversation';
import { EmptyBackground } from '@/components/session-view/empty-background';
import { QueuedPrompts } from '@/components/session-view/queued-prompts';
import { SiteDropdown } from '@/components/site-dropdown';
import { SitePreview } from '@/components/site-preview';
import { type Annotation } from '@/components/site-preview/types';
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

/**
 * Renders the annotation batch as a markdown prompt the user can review and
 * (optionally) edit before sending. Annotations are grouped by the page they
 * were taken on so the agent knows which URL to load before acting on each
 * element. Within a group, each item carries the element's tag, nearby text
 * and CSS selector — enough for the agent to locate the target without
 * re-running the inspector.
 */
function formatAnnotationsAsPrompt( annotations: Annotation[] ): string {
	const intro =
		annotations.length === 1
			? __( 'Apply this change from the site preview:' )
			: // translators: %d is the number of annotations.
			  __( 'Apply these %d changes from the site preview:' ).replace(
					'%d',
					String( annotations.length )
			  );

	// Group while preserving the order in which the user added the
	// annotations, then merge consecutive runs that share a page so a
	// chained sequence reads as a single section.
	const groups: { page: string; items: Annotation[] }[] = [];
	for ( const ann of annotations ) {
		const page = ann.url || ann.pathname || '/';
		const last = groups[ groups.length - 1 ];
		if ( last && last.page === page ) {
			last.items.push( ann );
		} else {
			groups.push( { page, items: [ ann ] } );
		}
	}

	const lines: string[] = [ intro, '' ];
	let counter = 1;
	for ( const group of groups ) {
		// translators: %s is the page URL or pathname.
		lines.push( __( 'On %s:' ).replace( '%s', group.page ) );
		for ( const ann of group.items ) {
			const tag = ann.tag ?? 'element';
			const nearby = ann.nearbyText ? ` — "${ ann.nearbyText.slice( 0, 80 ) }"` : '';
			const selector = ann.selector ? `\n   Selector: \`${ ann.selector }\`` : '';
			lines.push(
				`${ counter }. \`<${ tag }>\`${ nearby }\n   Comment: ${ ann.comment }${ selector }`
			);
			counter += 1;
		}
		lines.push( '' );
	}

	return lines.join( '\n' ).trimEnd();
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
	const composerRef = useRef< ComposerHandle | null >( null );
	const [ previewOpen, setPreviewOpen ] = useState( false );
	const canTogglePreview = !! ownerSite && effectiveEnvironment === 'local';
	const showPreview = previewOpen && canTogglePreview;

	const handleAnnotationsDone = useCallback( ( annotations: Annotation[] ) => {
		if ( annotations.length === 0 ) return;
		composerRef.current?.appendDraft( formatAnnotationsAsPrompt( annotations ) );
	}, [] );

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
						ref={ composerRef }
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
					<SitePreview
						site={ ownerSite }
						sessionId={ sessionId }
						onAnnotationsDone={ handleAnnotationsDone }
					/>
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
	);
}
