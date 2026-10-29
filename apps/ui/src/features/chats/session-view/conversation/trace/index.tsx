import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CircleAlertIcon, CircleCheckIcon, CircleStopIcon } from 'lucide-react';
import {
	Fragment,
	memo,
	useEffect,
	useId,
	useState,
	type ReactNode,
	type ComponentProps,
} from 'react';
import { getToolDisplay } from '@/features/chats/session-view/conversation/trace/tool-display';
import { ChevronDownIcon } from '@/lib/icons';
import { CodeBlock, CollapsiblePanel, Spinner } from '@/lib/ui';
import styles from './style.module.css';
import type { TurnActivity } from '@/features/chats/session-view/conversation/transcript-items';
import type { NormalizedToolResult } from '@studio/agent/protocol/tools';

function TraceTrigger( { children, ...props }: ComponentProps< 'button' > ) {
	return (
		<button type="button" className={ styles.traceTrigger } { ...props }>
			{ children }
			<ChevronDownIcon className={ styles.traceChevron } />
		</button>
	);
}

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
	const detailsId = useId();
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const hasInput = display.inputText.length > 0;
	const hasDiff = Boolean( result?.diff );
	const hasExpandableDetails = hasInput || hasOutput || hasDiff;
	const [ toggledOpen, setToggledOpen ] = useState< boolean | null >( null );
	const expanded = toggledOpen ?? result?.isError === true;
	const running = isRunning && ! result;
	const line = (
		<span className={ styles.traceLine } data-status={ result?.isError ? 'error' : undefined }>
			{ result?.isError ? (
				<CircleAlertIcon />
			) : result ? (
				<CircleCheckIcon />
			) : running ? (
				<Spinner aria-hidden="true" />
			) : (
				<CircleStopIcon />
			) }
			<span className={ clsx( styles.traceTitle, running && 'studio-shimmer' ) }>
				{ display.detail ? `${ display.label } ${ display.detail }` : display.label }
			</span>
		</span>
	);

	return (
		<div data-trace-row>
			{ hasExpandableDetails ? (
				<TraceTrigger
					aria-expanded={ expanded }
					aria-controls={ detailsId }
					onClick={ () => setToggledOpen( ! expanded ) }
				>
					{ line }
				</TraceTrigger>
			) : (
				line
			) }
			<CollapsiblePanel open={ hasExpandableDetails && expanded } id={ detailsId }>
				<div className={ styles.toolDetails }>
					{ hasInput ? (
						<CodeBlock
							className={ styles.toolCode }
							code={ display.inputText }
							language={ name === 'wp_cli' || name === 'Bash' ? 'shell' : 'json' }
						/>
					) : null }
					{ hasOutput ? <pre className={ styles.toolOutput }>{ resultText }</pre> : null }
					{ hasDiff ? (
						<CodeBlock
							className={ styles.toolCode }
							code={ result!.diff!.replace( /\n$/, '' ) }
							language="diff"
						/>
					) : null }
				</div>
			</CollapsiblePanel>
		</div>
	);
} );

function isPersistentItem( item: TurnActivity[ 'items' ][ number ] ) {
	return (
		item.kind === 'agent-question-batch' ||
		item.kind === 'chat-artifact' ||
		( item.kind === 'assistant-text' && item.persistent )
	);
}

const LIVE_COUNT_THRESHOLD_SECONDS = 10;

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
	const [ disclosure, setDisclosure ] = useState( { running, open: running } );
	if ( disclosure.running !== running ) {
		setDisclosure( { running, open: running } );
	}
	const expanded = disclosure.running === running ? disclosure.open : running;
	const visibleItems = expanded ? items : items.filter( isPersistentItem );
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
	const showLiveCount = seconds !== null && seconds >= LIVE_COUNT_THRESHOLD_SECONDS;
	const label = waiting
		? showLiveCount
			? sprintf(
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					__( 'Waiting for %s' ),
					duration
			  )
			: __( 'Waiting' )
		: running
		? showLiveCount
			? sprintf(
					/* translators: %s: elapsed time, e.g. "12s" or "1m 5s". */
					__( 'Working for %s' ),
					duration
			  )
			: __( 'Working' )
		: seconds === null
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
		<span className={ styles.traceLine } data-status={ status === 'error' ? 'error' : undefined }>
			<span className={ clsx( styles.traceTitle, running && ! waitingOnUser && 'studio-shimmer' ) }>
				{ label }
			</span>
		</span>
	);
	return (
		<div className={ styles.activity } data-turn-activity>
			{ hasContent ? (
				<TraceTrigger
					aria-expanded={ expanded }
					aria-controls={ controls }
					onClick={ () => setDisclosure( { running, open: ! expanded } ) }
				>
					{ heading }
				</TraceTrigger>
			) : (
				heading
			) }
			{ sections.map( ( section ) => {
				const first = section.items[ 0 ];
				const previous = visibleItems[ visibleItems.indexOf( first ) - 1 ];
				const separated =
					! previous || ( first.kind === 'tool-use' ) !== ( previous.kind === 'tool-use' );
				const content = (
					<div className={ styles.activityContent } data-separated={ separated || undefined }>
						{ renderItems?.( section.items, visibleItems ) }
					</div>
				);
				return section.persistent ? (
					<Fragment key={ section.key }>{ content }</Fragment>
				) : (
					<CollapsiblePanel
						key={ section.key }
						open={ expanded }
						id={ `${ panelId }-${ section.key }` }
					>
						{ content }
					</CollapsiblePanel>
				);
			} ) }
			{ hasProgress ? (
				<CollapsiblePanel open={ expanded } id={ `${ panelId }-progress` }>
					<div
						className={ styles.activityContent }
						data-separated={ visibleItems.at( -1 )?.kind !== 'tool-use' || undefined }
					>
						<span className={ styles.activityProgress }>{ progressMessage }</span>
					</div>
				</CollapsiblePanel>
			) : null }
		</div>
	);
} );
