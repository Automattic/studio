import { __ } from '@wordpress/i18n';
import { forwardRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/cx';
import { Message } from '../stores/chat-slice';
import Anchor from './assistant-anchor';
import createCodeComponent from './assistant-code-block';
import { FeedbackThanks } from './chat-rating';

export interface ChatMessageProps {
	children: React.ReactNode;
	id: string;
	className?: string;
	siteId?: string;
	message: Message;
	isUnauthenticated?: boolean;
	failedMessage?: boolean;
	feedbackReceived?: boolean;
	instanceId: string;
}

export const MarkDownWithCode = ( {
	message,
	siteId,
	content,
	instanceId,
}: {
	siteId?: string;
	content: string;
	message: Message;
	instanceId: string;
} ) => (
	<div className="assistant-markdown">
		<Markdown
			components={ {
				a: Anchor,
				code: createCodeComponent( {
					messageId: message.id,
					siteId,
					instanceId,
				} ),
				img: () => null,
			} }
			remarkPlugins={ [ remarkGfm ] }
		>
			{ content }
		</Markdown>
	</div>
);
export const ChatMessage = forwardRef< HTMLDivElement, ChatMessageProps >(
	( { id, message, className, siteId, children, isUnauthenticated, instanceId }, ref ) => {
		return (
			<>
				<div ref={ ref } className="h-4" />
				<div
					className={ cx(
						'flex',
						isUnauthenticated || message.role !== 'user'
							? 'justify-start ltr:md:mr-24 rtl:md:ml-24'
							: 'justify-end ltr:md:ml-24 rtl:md:mr-24',
						className
					) }
				>
					<div
						id={ id }
						role="group"
						data-testid="chat-message"
						aria-labelledby={ id }
						className={ cx(
							'inline-block p-3 rounded border overflow-x-auto select-text',
							isUnauthenticated ? 'lg:max-w-[90%]' : 'lg:max-w-[70%]',
							message.failedMessage
								? 'border-[#FACFD2] bg-[#F7EBEC]'
								: message.role === 'user'
								? 'bg-white'
								: 'bg-white/45',
							! message.failedMessage && 'border-gray-300'
						) }
					>
						<div className="relative">
							<span className="sr-only">
								{ message.role === 'user' ? __( 'Your message' ) : __( 'Studio Assistant' ) },
							</span>
						</div>
						{ typeof children === 'string' ? (
							<>
								<MarkDownWithCode
									message={ message }
									siteId={ siteId }
									instanceId={ instanceId }
									content={ children }
								/>
								{ message.feedbackReceived && <FeedbackThanks /> }
							</>
						) : (
							children
						) }
					</div>
				</div>
			</>
		);
	}
);
