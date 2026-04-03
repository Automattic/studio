import { useState, useRef, useEffect, useCallback } from 'react';
import { cx } from 'src/lib/cx';
import type { TaskMessage } from 'src/modules/ai/types';

/** Present-tense labels shown in the collapsed status bar while the tool is running. */
const TOOL_LABELS_ACTIVE: Record< string, string > = {
	Edit: 'Editing',
	Read: 'Reading',
	Write: 'Writing',
	Bash: 'Running command',
	Glob: 'Searching files',
	Grep: 'Searching',
	WebSearch: 'Searching the web',
	WebFetch: 'Fetching page',
};

/** Past-tense labels shown in the expanded activity log after the tool finishes. */
const TOOL_LABELS_PAST: Record< string, string > = {
	Edit: 'Edited',
	Read: 'Read',
	Write: 'Wrote',
	Bash: 'Ran command',
	Glob: 'Searched files',
	Grep: 'Searched',
	WebSearch: 'Searched the web',
	WebFetch: 'Fetched page',
};

function activeToolLabel( toolName: string ): string {
	return TOOL_LABELS_ACTIVE[ toolName ] ?? `Using ${ toolName }`;
}

function pastToolLabel( toolName: string ): string {
	return TOOL_LABELS_PAST[ toolName ] ?? toolName;
}

function formatValue( value: unknown ): string {
	if ( value === undefined || value === null ) {
		return '';
	}
	if ( typeof value === 'string' ) {
		return value;
	}
	try {
		return JSON.stringify( value, null, 2 );
	} catch {
		return String( value );
	}
}

function formatTimeSince( ts: number ): string {
	const diff = Math.floor( ( Date.now() - ts ) / 1000 );
	if ( diff < 5 ) {
		return 'just now';
	}
	if ( diff < 60 ) {
		return `${ diff }s ago`;
	}
	const minutes = Math.floor( diff / 60 );
	if ( minutes < 60 ) {
		return `${ minutes }m ago`;
	}
	const hours = Math.floor( minutes / 60 );
	if ( hours < 24 ) {
		return `${ hours }h ago`;
	}
	return new Date( ts ).toLocaleTimeString( [], {
		hour: 'numeric',
		minute: '2-digit',
	} );
}

function formatElapsed( seconds: number ): string {
	if ( seconds < 60 ) {
		return `${ seconds }s`;
	}
	const m = Math.floor( seconds / 60 );
	const s = seconds % 60;
	return `${ m }m ${ s }s`;
}

type ActivityStatus = 'streaming' | 'idle' | 'error';

interface ActivityState {
	label: string | null;
	status: ActivityStatus;
}

function deriveActivity( messages: TaskMessage[], isStreaming: boolean ): ActivityState {
	if ( messages.length === 0 && ! isStreaming ) {
		return { label: null, status: 'idle' };
	}

	if ( isStreaming ) {
		for ( let i = messages.length - 1; i >= 0; i-- ) {
			const msg = messages[ i ];
			if ( msg.role === 'tool' && msg.isStreaming ) {
				return {
					label: activeToolLabel( msg.toolName ?? 'tool' ),
					status: 'streaming',
				};
			}
		}
		return { label: 'Thinking', status: 'streaming' };
	}

	const lastMsg = messages[ messages.length - 1 ];
	if ( lastMsg?.isError ) {
		return { label: 'Error occurred', status: 'error' };
	}

	return { label: 'Ready', status: 'idle' };
}

/** Returns a live-updating elapsed-seconds counter while streaming is true. */
function useElapsedTime( isStreaming: boolean ): number | null {
	const startRef = useRef< number | null >( null );
	const [ elapsed, setElapsed ] = useState< number | null >( null );

	useEffect( () => {
		if ( isStreaming ) {
			if ( startRef.current === null ) {
				startRef.current = Date.now();
			}
			setElapsed( 0 );
			const interval = setInterval( () => {
				if ( startRef.current !== null ) {
					setElapsed( Math.floor( ( Date.now() - startRef.current ) / 1000 ) );
				}
			}, 1000 );
			return () => clearInterval( interval );
		}
		// Keep showing the final elapsed time when done
		if ( startRef.current !== null ) {
			setElapsed( Math.floor( ( Date.now() - startRef.current ) / 1000 ) );
			startRef.current = null;
		}
	}, [ isStreaming ] );

	return elapsed;
}

/**
 * Derive a human-readable label for a message in the activity log.
 * Uses past tense for completed tools, present for streaming ones.
 */
function logEntryLabel( message: TaskMessage ): string {
	if ( message.role === 'user' ) {
		const text = message.content;
		return text.length > 80 ? text.slice( 0, 77 ) + '…' : text;
	}
	if ( message.role === 'tool' ) {
		const name = message.toolName ?? 'Tool';
		if ( message.isStreaming ) {
			return activeToolLabel( name );
		}
		return pastToolLabel( name );
	}
	if ( message.role === 'assistant' ) {
		return 'Responding';
	}
	// system
	if ( message.isError ) {
		return 'Error';
	}
	return message.content.length > 80 ? message.content.slice( 0, 77 ) + '…' : message.content;
}

interface TaskActivityIndicatorProps {
	taskId: string;
	messages: TaskMessage[];
	isStreaming: boolean;
}

export function TaskActivityIndicator( {
	taskId: _taskId,
	messages,
	isStreaming,
}: TaskActivityIndicatorProps ) {
	const [ expanded, setExpanded ] = useState( false );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const activity = deriveActivity( messages, isStreaming );
	const elapsed = useElapsedTime( isStreaming );

	// Click-outside to close expanded panel
	useEffect( () => {
		if ( ! expanded ) {
			return;
		}
		const handleMouseDown = ( e: MouseEvent ) => {
			if ( wrapperRef.current && ! wrapperRef.current.contains( e.target as Node ) ) {
				setExpanded( false );
			}
		};
		document.addEventListener( 'mousedown', handleMouseDown );
		return () => document.removeEventListener( 'mousedown', handleMouseDown );
	}, [ expanded ] );

	if ( ! activity.label ) {
		return null;
	}

	return (
		<div ref={ wrapperRef } className="px-4">
			<div className="relative">{ expanded && <ActivityLogPanel messages={ messages } /> }</div>
			<button
				onClick={ () => setExpanded( ! expanded ) }
				className="w-full flex items-center gap-2.5 px-1 py-1.5 text-left"
			>
				{ activity.status === 'streaming' && (
					<span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-[#4f94f8] animate-pulse" />
				) }
				<span className="flex-1 text-xs text-frame-text-secondary truncate">
					{ expanded ? 'Activity' : activity.label }
				</span>
				{ elapsed !== null && (
					<span className="text-[11px] text-frame-text-tertiary flex-shrink-0 tabular-nums">
						{ formatElapsed( elapsed ) }
					</span>
				) }
			</button>
		</div>
	);
}

function ActivityLogPanel( { messages }: { messages: TaskMessage[] } ) {
	const scrollRef = useRef< HTMLDivElement >( null );

	// Auto-scroll to bottom
	useEffect( () => {
		if ( scrollRef.current ) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [ messages.length ] );

	return (
		<div className="absolute bottom-full left-0 right-0 mb-0 max-h-72 flex flex-col z-20 overflow-hidden bg-frame rounded-t-lg border border-b-0 border-frame-border shadow-lg">
			<div
				ref={ scrollRef }
				className="flex-1 overflow-y-auto"
				style={ { scrollbarWidth: 'thin' } }
			>
				<div className="flex flex-col gap-0.5 py-2">
					{ messages.map( ( message ) => (
						<ActivityLogEntry key={ message.id } message={ message } />
					) ) }
				</div>
			</div>
		</div>
	);
}

function ActivityLogEntry( { message }: { message: TaskMessage } ) {
	if ( message.role === 'tool' ) {
		return <ToolLogEntry message={ message } />;
	}

	const label = logEntryLabel( message );
	const isUser = message.role === 'user';

	return (
		<div className="flex items-baseline gap-2.5 px-3 py-1">
			<span
				className={ cx(
					'flex-1 min-w-0 text-xs truncate',
					isUser && 'text-frame-text',
					! isUser && message.isError && 'text-red-500',
					! isUser && ! message.isError && 'text-frame-text-secondary'
				) }
			>
				{ label }
			</span>
			<span className="flex-shrink-0 text-[11px] text-frame-text-tertiary tabular-nums">
				{ formatTimeSince( message.timestamp ) }
			</span>
		</div>
	);
}

function ToolLogEntry( { message }: { message: TaskMessage } ) {
	const [ expanded, setExpanded ] = useState( false );
	const hasInput = message.toolInput !== undefined && message.toolInput !== null;
	const hasResult = message.toolResult !== undefined && message.toolResult !== '';
	const hasDetails = hasInput || hasResult;
	const label = logEntryLabel( message );

	const handleToggle = useCallback( () => {
		if ( hasDetails ) {
			setExpanded( ( prev ) => ! prev );
		}
	}, [ hasDetails ] );

	return (
		<div>
			<button
				onClick={ handleToggle }
				className={ cx(
					'w-full flex items-baseline gap-2.5 px-3 py-1 text-left',
					hasDetails && 'cursor-pointer hover:bg-frame-surface/50',
					! hasDetails && 'cursor-default'
				) }
			>
				<span className="flex-1 min-w-0 text-xs text-frame-text-secondary truncate">{ label }</span>
				{ message.isError && <span className="flex-shrink-0 text-[11px] text-red-500">error</span> }
				<span className="flex-shrink-0 text-[11px] text-frame-text-tertiary tabular-nums">
					{ formatTimeSince( message.timestamp ) }
				</span>
			</button>

			{ expanded && (
				<div className="mx-3 mb-1 rounded bg-frame-surface/50 overflow-hidden">
					{ hasInput && (
						<div className="px-3 py-2">
							<div className="text-[10px] uppercase tracking-wide text-frame-text-tertiary mb-1">
								Input
							</div>
							<pre className="text-[11px] font-mono text-frame-text-secondary whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
								{ formatValue( message.toolInput ) }
							</pre>
						</div>
					) }
					{ hasResult && (
						<div className={ cx( 'px-3 py-2', hasInput && 'border-t border-frame-border/50' ) }>
							<div className="text-[10px] uppercase tracking-wide text-frame-text-tertiary mb-1">
								Output
							</div>
							<pre
								className={ cx(
									'text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto',
									message.isError ? 'text-red-500' : 'text-frame-text-secondary'
								) }
							>
								{ message.toolResult }
							</pre>
						</div>
					) }
				</div>
			) }
		</div>
	);
}
