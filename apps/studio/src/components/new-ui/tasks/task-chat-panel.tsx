import { useEffect, useRef } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useRootSelector } from 'src/stores';
import { TaskChatInput } from './task-chat-input';
import { TaskMessageList } from './task-message-list';
import { TaskPermissionPrompt } from './task-permission-prompt';
import type { UseElementSelectorReturn } from 'src/hooks/use-element-selector';

interface TaskChatPanelProps {
	taskId: string;
	toolbar?: React.ReactNode;
	elementSelector?: UseElementSelectorReturn;
}

export function TaskChatPanel( { taskId, toolbar, elementSelector }: TaskChatPanelProps ) {
	const task = useRootSelector( ( state ) => state.tasks.tasks.find( ( t ) => t.id === taskId ) );
	const messages = useRootSelector( ( state ) => state.tasks.messagesByTask[ taskId ] ?? [] );
	const isStreaming = useRootSelector(
		( state ) => state.tasks.streamingByTask[ taskId ] ?? false
	);
	const hasPendingPermissions = useRootSelector( ( state ) =>
		state.tasks.pendingPermissions.some( ( p ) => p.taskId === taskId )
	);
	const { sites } = useSiteDetails();
	const site = sites.find( ( s ) => s.id === task?.siteId );
	const scrollRef = useRef< HTMLDivElement >( null );

	// Auto-scroll to bottom when new messages arrive
	useEffect( () => {
		if ( scrollRef.current ) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [ messages.length, isStreaming ] );

	if ( ! task ) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<span className="text-sm text-frame-text-secondary">Task not found</span>
			</div>
		);
	}

	return (
		<div ref={ scrollRef } className="flex-1 overflow-y-auto" style={ { scrollbarWidth: 'thin' } }>
			<div className="flex flex-col min-h-full">
				{ /* Sticky toolbar with progressive blur */ }
				{ toolbar && <div className="sticky top-0 z-10 task-toolbar-blur">{ toolbar }</div> }

				<div className="flex-1">
					{ messages.length === 0 ? (
						<EmptyState siteName={ site?.name } />
					) : (
						<TaskMessageList messages={ messages } isStreaming={ isStreaming } />
					) }
				</div>

				{ /* Sticky footer — input with progressive blur */ }
				<div className="sticky bottom-0 z-10 pointer-events-none task-chat-footer">
					<div className="pointer-events-auto">
						{ /* Permission prompt — shown above input when agent needs approval */ }
						{ hasPendingPermissions && <TaskPermissionPrompt taskId={ taskId } /> }
						<TaskChatInput
							taskId={ taskId }
							isStreaming={ isStreaming }
							elementSelector={ elementSelector }
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function EmptyState( { siteName }: { siteName?: string } ) {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 px-8">
			<div className="text-sm text-frame-text-secondary text-center">
				{ siteName ? `Start a conversation about ${ siteName }` : 'Start a conversation' }
			</div>
			<div className="text-xs text-frame-text-tertiary text-center max-w-sm">
				Ask the AI agent to help you build, customize, or manage your WordPress site.
			</div>
		</div>
	);
}
