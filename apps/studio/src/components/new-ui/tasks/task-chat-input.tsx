import { useState, useRef, useCallback } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { appendTaskMessage, setTaskStreaming } from 'src/stores/tasks-slice';
import type { TaskMessage } from 'src/modules/ai/types';

interface TaskChatInputProps {
	taskId: string;
	isStreaming: boolean;
}

export function TaskChatInput( { taskId, isStreaming }: TaskChatInputProps ) {
	const [ value, setValue ] = useState( '' );
	const textareaRef = useRef< HTMLTextAreaElement >( null );
	const dispatch = useAppDispatch();
	const messages = useRootSelector( ( state ) => state.tasks.messagesByTask[ taskId ] ?? [] );

	const handleSend = useCallback( () => {
		const trimmed = value.trim();
		if ( ! trimmed || isStreaming ) {
			return;
		}

		// Add user message to local state immediately
		const userMessage: TaskMessage = {
			id: `user-${ Date.now() }`,
			role: 'user',
			content: trimmed,
			timestamp: Date.now(),
		};
		dispatch( appendTaskMessage( { taskId, message: userMessage } ) );
		dispatch( setTaskStreaming( { taskId, streaming: true } ) );
		setValue( '' );

		// Send to the agent via IPC
		const isFirstMessage = messages.length === 0;
		if ( isFirstMessage ) {
			// Auto-generate task title from first message
			const title = trimmed.length > 50 ? trimmed.slice( 0, 47 ) + '...' : trimmed;
			void getIpcApi().updateTask( taskId, { title } );

			// First message — start a new agent session
			void getIpcApi().startTaskAgentHandler( taskId, trimmed );
		} else {
			// Follow-up — send to the existing agent
			void getIpcApi().sendTaskMessageHandler( taskId, trimmed );
		}
	}, [ value, isStreaming, taskId, dispatch, messages.length ] );

	const handleKeyDown = ( e: React.KeyboardEvent ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="p-4">
			<div className="flex items-end gap-2">
				<textarea
					ref={ textareaRef }
					value={ value }
					onChange={ ( e ) => setValue( e.target.value ) }
					onKeyDown={ handleKeyDown }
					placeholder="Ask the agent..."
					disabled={ isStreaming }
					rows={ 1 }
					className={ cx(
						'flex-1 resize-none rounded-lg border border-frame-border bg-frame-surface px-3 py-2',
						'text-sm text-frame-text placeholder:text-frame-text-tertiary',
						'focus:outline-none focus:border-frame-theme',
						'disabled:opacity-50',
						'max-h-32'
					) }
					style={ { fieldSizing: 'content' } as React.CSSProperties }
				/>
				<button
					onClick={ handleSend }
					disabled={ ! value.trim() || isStreaming }
					className={ cx(
						'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
						'bg-frame-theme text-white',
						'hover:opacity-90',
						'disabled:opacity-50 disabled:cursor-not-allowed'
					) }
				>
					Send
				</button>
			</div>
		</div>
	);
}
