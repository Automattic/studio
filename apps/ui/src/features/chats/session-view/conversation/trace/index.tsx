import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, CircleStopIcon } from 'lucide-react';
import { useEffect, useId, useState, type ComponentProps } from 'react';
import { getToolDisplay } from '@/features/chats/session-view/conversation/trace/tool-display';
import { CodeBlock, CollapsiblePanel, Spinner } from '@/lib/ui';
import styles from './style.module.css';
import type { TurnActivity } from '@/features/chats/session-view/conversation/transcript-items';
import type { NormalizedToolResult } from '@studio/common/ai/tools';

function TraceTrigger( { children, ...props }: ComponentProps< 'button' > ) {
	return (
		<button type="button" className={ styles.traceTrigger } { ...props }>
			{ children }
			<ChevronRightIcon className={ styles.traceChevron } />
		</button>
	);
}

export function ToolUseRow( {
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
		<div className={ styles.toolRow }>
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
}

export function TurnActivityLine( {
	activity: { startedAt, endedAt, status },
	waitingOnUser,
	progressMessage,
}: {
	activity: TurnActivity;
	waitingOnUser: boolean;
	progressMessage: string | null;
} ) {
	const running = status === 'running';
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
	const label =
		seconds === null && status !== 'running'
			? { success: __( 'Worked' ), interrupted: __( 'Stopped' ), error: __( 'Failed' ) }[ status ]
			: sprintf(
					{
						/* translators: %d: number of seconds. */
						running: __( 'Working for %ds' ),
						/* translators: %d: number of seconds. */
						success: __( 'Worked for %ds' ),
						/* translators: %d: number of seconds. */
						interrupted: __( 'Stopped after %ds' ),
						/* translators: %d: number of seconds. */
						error: __( 'Failed after %ds' ),
					}[ status ],
					seconds ?? 0
			  );
	return (
		<div className={ styles.activity }>
			<span className={ styles.traceLine } data-status={ status === 'error' ? 'error' : undefined }>
				<span
					className={ clsx( styles.traceTitle, running && ! waitingOnUser && 'studio-shimmer' ) }
				>
					{ label }
				</span>
			</span>
			{ running && progressMessage ? (
				<span className={ styles.activityProgress }>{ progressMessage }</span>
			) : null }
		</div>
	);
}
