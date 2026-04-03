import { cx } from 'src/lib/cx';
import type { TaskMessage } from 'src/modules/ai/types';

interface TaskMessageListProps {
	messages: TaskMessage[];
	isStreaming: boolean;
}

export function TaskMessageList( { messages, isStreaming }: TaskMessageListProps ) {
	const conversationMessages = messages.filter( ( m ) => m.role !== 'tool' );

	return (
		<div className="flex flex-col gap-3 p-6">
			{ conversationMessages.map( ( message ) => (
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
				<div className="max-w-[80%] rounded-lg px-4 py-2 bg-frame-surface text-frame-text text-sm">
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

	// assistant or system
	return (
		<div
			className={ cx(
				'text-sm text-frame-text',
				message.isError && 'border border-red-300 bg-red-50 text-red-800 rounded-lg px-4 py-2'
			) }
		>
			<div className="whitespace-pre-wrap">{ message.content }</div>
		</div>
	);
}
