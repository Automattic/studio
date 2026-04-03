import { cx } from 'src/lib/cx';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { dequeueMessage } from 'src/stores/tasks-slice';
import type { QueuedMessage } from 'src/stores/tasks-slice';

interface TaskQueuedMessagesProps {
	taskId: string;
	onRestore: ( message: QueuedMessage ) => void;
}

export function TaskQueuedMessages( { taskId, onRestore }: TaskQueuedMessagesProps ) {
	const queue = useRootSelector( ( state ) => state.tasks.queuedMessagesByTask[ taskId ] ?? [] );
	const dispatch = useAppDispatch();

	if ( queue.length === 0 ) {
		return null;
	}

	return (
		<div className="px-4 pb-1 flex flex-col gap-1">
			{ queue.map( ( item ) => {
				const label = item.text || buildAttachmentLabel( item );
				return (
					<div
						key={ item.id }
						className={ cx(
							'flex items-center gap-2 px-3 py-1.5 rounded-lg',
							'bg-frame-surface border border-frame-border',
							'text-xs text-frame-text-secondary group',
							'transition-colors duration-150'
						) }
					>
						<button
							onClick={ () => {
								dispatch( dequeueMessage( { taskId, messageId: item.id } ) );
								onRestore( item );
							} }
							className="flex-1 truncate text-left hover:text-frame-text transition-colors"
						>
							{ label }
						</button>
						<button
							onClick={ () => dispatch( dequeueMessage( { taskId, messageId: item.id } ) ) }
							className={ cx(
								'w-4 h-4 flex-shrink-0 flex items-center justify-center',
								'opacity-0 group-hover:opacity-100 transition-opacity',
								'text-frame-text-tertiary hover:text-frame-text-secondary'
							) }
						>
							&times;
						</button>
					</div>
				);
			} ) }
		</div>
	);
}

function buildAttachmentLabel( message: QueuedMessage ): string {
	const parts: string[] = [];
	if ( message.images?.length ) {
		parts.push( `${ message.images.length } image${ message.images.length > 1 ? 's' : '' }` );
	}
	if ( message.elements?.length ) {
		parts.push( `${ message.elements.length } element${ message.elements.length > 1 ? 's' : '' }` );
	}
	return parts.length > 0 ? `[Attached ${ parts.join( ' and ' ) }]` : '';
}
