import { __ } from '@wordpress/i18n';
import { forwardRef } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import Anchor from 'src/components/assistant-anchor';
import createCodeComponent from 'src/components/assistant-code-block';
import { ChatRating } from 'src/components/chat-rating';
import { CopyTextButton } from 'src/components/copy-text-button';
import { cx } from 'src/lib/cx';
import { Message } from 'src/stores/chat-slice';

export interface ChatMessageProps {
	children: React.ReactNode;
	id: string;
	className?: string;
	siteId?: string;
	message: Message;
	isUnauthenticated?: boolean;
	failedMessage?: boolean;
	instanceId: string;
	onRate?: ( ratingValue: number ) => void;
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
			rehypePlugins={ [ rehypeRaw ] }
		>
			{ content }
		</Markdown>
	</div>
);

const MessageActions = ( {
	content,
	isAssistant,
	onRate,
}: {
	content: string;
	isAssistant: boolean;
	onRate?: ( ratingValue: number ) => void;
} ) => (
	<div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
		<CopyTextButton
			text={ content }
			variant="icon"
			className="text-a8c-gray-70 hover:!text-a8c-blue-50"
			iconSize={ 18 }
		/>
		{ isAssistant && <ChatRating onRate={ onRate } /> }
	</div>
);

export const ChatMessage = forwardRef< HTMLDivElement, ChatMessageProps >(
	( { id, message, className, siteId, children, isUnauthenticated, instanceId, onRate }, ref ) => {
		const isString = typeof children === 'string';

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
							'group inline-block p-3 overflow-x-auto overflow-y-hidden select-text',
							isUnauthenticated ? 'lg:max-w-[90%]' : 'lg:max-w-[70%]',
							message.failedMessage
								? 'rounded border border-[#FACFD2] bg-[#F7EBEC]'
								: message.role === 'user' && 'rounded-xl bg-a8c-gray-100'
						) }
					>
						<div className="relative">
							<span className="sr-only">
								{ message.role === 'user' ? __( 'Your message' ) : __( 'Studio Assistant' ) },
							</span>
						</div>
						{ isString ? (
							<MarkDownWithCode
								message={ message }
								siteId={ siteId }
								instanceId={ instanceId }
								content={ children }
							/>
						) : (
							children
						) }
						{ message.content && (
							<MessageActions
								content={ message.content }
								isAssistant={ message.role === 'assistant' }
								onRate={ onRate }
							/>
						) }
					</div>
				</div>
			</>
		);
	}
);
