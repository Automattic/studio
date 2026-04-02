import { useState } from 'react';
import { cx } from 'src/lib/cx';
import type { TaskMessage } from 'src/modules/ai/types';

interface TaskMessageListProps {
	messages: TaskMessage[];
	isStreaming: boolean;
}

export function TaskMessageList( { messages, isStreaming }: TaskMessageListProps ) {
	return (
		<div className="flex flex-col gap-3 p-6">
			{ messages.map( ( message ) => (
				<MessageBubble key={ message.id } message={ message } />
			) ) }
			{ isStreaming && (
				<div className="flex items-center gap-2 px-4 py-2">
					<div className="flex gap-1">
						<span className="w-1.5 h-1.5 rounded-full bg-frame-text-tertiary animate-bounce" />
						<span className="w-1.5 h-1.5 rounded-full bg-frame-text-tertiary animate-bounce [animation-delay:150ms]" />
						<span className="w-1.5 h-1.5 rounded-full bg-frame-text-tertiary animate-bounce [animation-delay:300ms]" />
					</div>
				</div>
			) }
		</div>
	);
}

function MessageBubble( { message }: { message: TaskMessage } ) {
	if ( message.role === 'user' ) {
		const hasImages = message.images && message.images.length > 0;
		return (
			<div className="flex justify-end">
				<div className="max-w-[80%] rounded-lg px-4 py-2 bg-frame-theme text-white text-sm">
					{ hasImages && (
						<div className={ cx( 'flex gap-1.5 flex-wrap', message.content && 'mb-2' ) }>
							{ message.images!.map( ( img, i ) => (
								<img
									key={ i }
									src={ `data:${ img.mediaType };base64,${ img.data }` }
									alt={ `Attachment ${ i + 1 }` }
									className="w-24 h-24 rounded object-cover"
								/>
							) ) }
						</div>
					) }
					{ message.content && <div className="whitespace-pre-wrap">{ message.content }</div> }
				</div>
			</div>
		);
	}

	if ( message.role === 'tool' ) {
		return <ToolMessage message={ message } />;
	}

	// assistant or system
	return (
		<div className="flex">
			<div
				className={ cx(
					'max-w-[90%] rounded-lg px-4 py-2 text-sm',
					'bg-frame-surface text-frame-text',
					message.isError && 'border border-red-300 bg-red-50 text-red-800'
				) }
			>
				<div className="whitespace-pre-wrap">{ message.content }</div>
			</div>
		</div>
	);
}

function ToolMessage( { message }: { message: TaskMessage } ) {
	const [ expanded, setExpanded ] = useState( false );
	const hasInput = message.toolInput !== undefined && message.toolInput !== null;
	const hasResult = message.toolResult !== undefined && message.toolResult !== '';
	const hasDetails = hasInput || hasResult;

	return (
		<div className="flex">
			<div className="max-w-[90%] rounded-lg bg-frame-surface border border-frame-border overflow-hidden">
				{ /* Tool header — clickable to expand */ }
				<button
					onClick={ () => hasDetails && setExpanded( ! expanded ) }
					className={ cx(
						'w-full flex items-center gap-2 px-3 py-1.5 text-left',
						hasDetails && 'cursor-pointer hover:bg-frame-border/30',
						! hasDetails && 'cursor-default'
					) }
				>
					<span
						className={ cx(
							'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
							message.isStreaming && 'bg-[#4f94f8] animate-pulse',
							message.isError && 'bg-red-500',
							! message.isStreaming && ! message.isError && 'bg-[#4ab866]'
						) }
					/>
					<span className="text-xs font-mono text-frame-text-secondary flex-1 truncate">
						{ message.toolName ?? message.content }
					</span>
					{ hasDetails && (
						<span className="text-[10px] text-frame-text-tertiary flex-shrink-0">
							{ expanded ? '\u25B2' : '\u25BC' }
						</span>
					) }
				</button>

				{ /* Expanded details */ }
				{ expanded && (
					<div className="border-t border-frame-border">
						{ hasInput && (
							<div className="px-3 py-2">
								<div className="text-[10px] uppercase tracking-wide text-frame-text-tertiary mb-1">
									Input
								</div>
								<pre className="text-xs font-mono text-frame-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
									{ formatValue( message.toolInput ) }
								</pre>
							</div>
						) }
						{ hasResult && (
							<div className={ cx( 'px-3 py-2', hasInput && 'border-t border-frame-border' ) }>
								<div className="text-[10px] uppercase tracking-wide text-frame-text-tertiary mb-1">
									Output
								</div>
								<pre
									className={ cx(
										'text-xs font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto',
										message.isError ? 'text-red-600' : 'text-frame-text-secondary'
									) }
								>
									{ message.toolResult }
								</pre>
							</div>
						) }
					</div>
				) }
			</div>
		</div>
	);
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
