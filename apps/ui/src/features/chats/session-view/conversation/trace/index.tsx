import { getAiSkillCommands } from '@studio/agent/protocol/slash-commands';
import { getSkillDisplayName } from '@studio/common/lib/skill-draft';
import {
	CodeBlock,
	CollapsiblePanel,
	Spinner,
	Trace,
	TraceButton as TraceTrigger,
	TraceCollapsible,
	TraceCollapsibleTrigger,
	TraceCollapsibleContent,
	TraceDetails,
	TraceLine,
	TraceTitle,
	TraceIcon,
} from '@studio/ds';
import { CircleStopIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CircleAlertIcon } from 'lucide-react';
import { memo, useEffect, useId, useState, type ReactNode } from 'react';
import { canJoinBubbles } from '@/features/chats/session-view/conversation/joined';
import { getToolDisplay } from '@/features/chats/session-view/conversation/trace/tool-display';
import styles from './style.module.css';
import type { TurnActivity } from '@/features/chats/session-view/conversation/transcript-items';
import type { NormalizedToolResult } from '@studio/agent/protocol/tools';

// "Performance audit" for Studio's `need-for-speed`, "Lookbook post" for the user's `lookbook-post`.
const getSkillTitle = ( name: string ) =>
	getAiSkillCommands().find( ( command ) => command.name === name )?.displayName ??
	getSkillDisplayName( name );

export const ToolUseRow = memo( function ToolUseRow( {
	name,
	input,
	result,
	isRunning,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
	isRunning: boolean;
} ) {
	const display = getToolDisplay( name, input );
	const { Icon } = display;
	const resultText = result?.text?.trim() ?? '';
	// A skill's result is its instructions, which are for the agent: the row shows what the
	// skill is. An error is still shown.
	const hasOutput = resultText.length > 0 && ( name !== 'Skill' || result?.isError === true );
	const hasInput = display.inputText.length > 0;
	const hasDiff = Boolean( result?.diff );
	const skill = result?.skill;
	const hasExpandableDetails = hasInput || hasOutput || hasDiff || !! skill;
	const [ toggledOpen, setToggledOpen ] = useState< boolean | null >( null );
	const expanded = toggledOpen ?? result?.isError === true;
	const running = isRunning && ! result;
	const line = (
		<TraceLine status={ result?.isError ? 'error' : running ? 'running' : undefined }>
			<TraceIcon className={ styles.toolIcon }>
				{ result?.isError ? (
					<CircleAlertIcon />
				) : result ? (
					<Icon />
				) : running ? (
					<Spinner aria-hidden="true" />
				) : (
					<CircleStopIcon />
				) }
			</TraceIcon>
			<TraceTitle className={ clsx( running && 'studio-shimmer' ) }>
				{ display.detail ? `${ display.label } ${ display.detail }` : display.label }
			</TraceTitle>
		</TraceLine>
	);

	return (
		<TraceCollapsible
			className={ styles.tool }
			data-trace-row
			open={ hasExpandableDetails && expanded }
			onOpenChange={ setToggledOpen }
		>
			{ hasExpandableDetails ? (
				<TraceCollapsibleTrigger className={ styles.toolTrigger }>{ line }</TraceCollapsibleTrigger>
			) : (
				line
			) }
			<TraceCollapsibleContent className={ styles.toolDetails }>
				{ hasInput ? (
					<CodeBlock
						variant="plain"
						code={ display.inputText }
						language={ name === 'wp_cli' || name === 'Bash' ? 'shell' : 'json' }
					/>
				) : null }
				{ skill ? (
					<p className={ styles.toolSkill }>
						<span className={ styles.toolSkillName }>{ getSkillTitle( skill.name ) }</span>
						{ skill.description }
					</p>
				) : null }
				{ hasOutput ? <pre className={ styles.toolOutput }>{ resultText }</pre> : null }
				{ hasDiff ? (
					<CodeBlock variant="plain" code={ result!.diff!.replace( /\n$/, '' ) } language="diff" />
				) : null }
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
} );

function isPersistentItem( item: TurnActivity[ 'items' ][ number ] ) {
	return (
		item.kind === 'agent-question-batch' ||
		item.kind === 'chat-artifact' ||
		item.kind === 'assistant-text'
	);
}

const COUNT_THRESHOLD_SECONDS = 10;

export function formatElapsed( totalSeconds: number ) {
	const hours = Math.floor( totalSeconds / 3600 );
	const minutes = Math.floor( ( totalSeconds % 3600 ) / 60 );
	const seconds = totalSeconds % 60;
	if ( hours > 0 ) {
		/* translators: %1$d: hours, %2$d: minutes. */
		return sprintf( __( '%1$dh %2$dm' ), hours, minutes );
	}
	if ( minutes > 0 ) {
		/* translators: %1$d: minutes, %2$d: seconds. */
		return sprintf( __( '%1$dm %2$ds' ), minutes, seconds );
	}
	/* translators: %d: seconds. */
	return sprintf( __( '%ds' ), seconds );
}

export const TurnActivityLine = memo( function TurnActivityLine( {
	activity: { startedAt, endedAt, status, items },
	waitingOnUser,
	progressMessage,
	renderItems,
}: {
	activity: TurnActivity;
	waitingOnUser: boolean;
	progressMessage: string | null;
	renderItems?: (
		items: TurnActivity[ 'items' ],
		visibleItems: TurnActivity[ 'items' ]
	) => ReactNode;
} ) {
	const running = status === 'running';
	const waiting = running && waitingOnUser;
	const hasProgress = running && Boolean( progressMessage?.trim() );
	const hasContent = items.some( ( item ) => ! isPersistentItem( item ) ) || hasProgress;
	const panelId = useId();
	const sections: Array< { key: string; items: TurnActivity[ 'items' ]; persistent: boolean } > =
		[];
	for ( const item of items ) {
		const previous = sections[ sections.length - 1 ];
		const persistent = !! isPersistentItem( item );
		if ( ! persistent && previous && ! previous.persistent ) {
			previous.items.push( item );
		} else {
			sections.push( { key: item.key, items: [ item ], persistent } );
		}
	}
	const controls = [
		...sections
			.filter( ( section ) => ! section.persistent )
			.map( ( section ) => `${ panelId }-${ section.key }` ),
		...( hasProgress ? [ `${ panelId }-progress` ] : [] ),
	].join( ' ' );
	const working = running && ! waiting;
	const [ disclosure, setDisclosure ] = useState( { running, waiting, open: false } );
	if ( disclosure.running !== running || disclosure.waiting !== waiting ) {
		setDisclosure( { running, waiting, open: false } );
	}
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		if ( ! running ) {
			return;
		}
		setNow( Date.now() );
		const timer = window.setInterval( () => setNow( Date.now() ), 1000 );
		return () => window.clearInterval( timer );
	}, [ running ] );
	const end = running ? now : endedAt;
	const seconds =
		startedAt === null || end === null
			? null
			: Math.max( 0, Math.floor( ( end - startedAt ) / 1000 ) );
	const duration = formatElapsed( seconds ?? 0 );
	const showCount = seconds !== null && seconds >= COUNT_THRESHOLD_SECONDS;
	const isQuickReply =
		status === 'success' &&
		seconds !== null &&
		! showCount &&
		! items.some( ( item ) => item.kind === 'tool-use' );
	const expanded =
		isQuickReply ||
		( disclosure.running === running && disclosure.waiting === waiting ? disclosure.open : false );
	const visibleItems = expanded ? items : items.filter( isPersistentItem );
	const label = waiting
		? showCount
			? sprintf(
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					__( 'Waiting for %s' ),
					duration
			  )
			: __( 'Waiting' )
		: running
		? showCount
			? sprintf(
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					__( 'Working for %s' ),
					duration
			  )
			: __( 'Working' )
		: ! showCount
		? { success: __( 'Worked' ), interrupted: __( 'You stopped' ), error: __( 'Failed' ) }[ status ]
		: sprintf(
				{
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					success: __( 'Worked for %s' ),
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					interrupted: __( 'You stopped after %s' ),
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					error: __( 'Failed after %s' ),
				}[ status ],
				duration
		  );
	const heading = (
		<TraceLine status={ status === 'error' ? 'error' : undefined }>
			<TraceTitle className={ clsx( running && ! waitingOnUser && 'studio-shimmer' ) }>
				{ working && progressMessage ? progressMessage : label }
			</TraceTitle>
		</TraceLine>
	);
	return (
		<Trace className={ styles.activity } data-turn-activity>
			{ isQuickReply ? null : hasContent ? (
				<TraceTrigger
					aria-expanded={ expanded }
					aria-controls={ controls }
					onClick={ () => setDisclosure( { running, waiting, open: ! expanded } ) }
				>
					{ heading }
				</TraceTrigger>
			) : (
				heading
			) }
			{ sections.map( ( section, index ) => {
				const first = isQuickReply && index === 0;
				const item = section.items[ 0 ];
				const previous = visibleItems[ visibleItems.indexOf( item ) - 1 ];
				const content = renderItems?.( section.items, visibleItems );
				return section.persistent ? (
					<div
						key={ section.key }
						className={ styles.activityContent }
						data-first={ first || undefined }
						data-joined-above={ canJoinBubbles( item, previous ) || undefined }
					>
						{ content }
					</div>
				) : (
					<CollapsiblePanel
						key={ section.key }
						open={ expanded }
						id={ `${ panelId }-${ section.key }` }
					>
						<TraceDetails className={ styles.activityDetails } data-first={ first || undefined }>
							{ content }
						</TraceDetails>
					</CollapsiblePanel>
				);
			} ) }
			{ hasProgress ? (
				<CollapsiblePanel open={ expanded } id={ `${ panelId }-progress` }>
					<TraceDetails className={ styles.activityDetails }>
						<span className={ styles.activityProgress }>{ progressMessage }</span>
					</TraceDetails>
				</CollapsiblePanel>
			) : null }
		</Trace>
	);
} );
