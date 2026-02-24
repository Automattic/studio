import { __ } from '@wordpress/i18n';
import { forwardRef } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import Anchor from 'src/components/assistant-anchor';
import createCodeComponent from 'src/components/assistant-code-block';
import { copy, Icon } from '@wordpress/icons';
import { useCallback, useState } from 'react';
import Button from 'src/components/button';
import { ChatRating } from 'src/components/chat-rating';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
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

const CopyButton = ( { text }: { text: string } ) => {
	const [ showCopied, setShowCopied ] = useState( false );
	const onClick = useCallback( () => {
		void getIpcApi().copyText( text );
		setShowCopied( true );
		setTimeout( () => setShowCopied( false ), 2000 );
	}, [ text ] );

	return (
		<Button
			variant="icon"
			className={ cx(
				'text-a8c-gray-70 hover:!text-a8c-blue-50',
				showCopied && '!text-a8c-blue-50'
			) }
			onClick={ onClick }
			tooltipText={ __( 'Copy to clipboard' ) }
		>
			<Icon size={ 18 } icon={ copy } />
		</Button>
	);
};

const MessageActions = ( {
	content,
	isAssistant,
	onRate,
}: {
	content: string;
	isAssistant: boolean;
	onRate?: ( ratingValue: number ) => void;
} ) => (
	<div className="flex items-center gap-1 mt-2 pl-3 opacity-0 group-hover:opacity-100 transition-opacity">
		<CopyButton text={ content } />
		{ isAssistant && <ChatRating onRate={ onRate } /> }
	</div>
);

export const ChatMessage = forwardRef< HTMLDivElement, ChatMessageProps >(
	( { id, message, className, siteId, children, isUnauthenticated, instanceId, onRate }, ref ) => {
		const isString = typeof children === 'string';

		const isUser = message.role === 'user';

		return (
			<>
				<div ref={ ref } className="h-4" />
				<div
					className={ cx(
						'group flex',
						isUnauthenticated || ! isUser
							? 'justify-start ltr:md:mr-24 rtl:md:ml-24'
							: 'justify-end ltr:md:ml-24 rtl:md:mr-24',
						className
					) }
				>
					<div className={ cx(
						'inline-flex flex-col',
						isUnauthenticated ? 'lg:max-w-[90%]' : 'lg:max-w-[70%]',
					) }>
						<div
							id={ id }
							role="group"
							data-testid="chat-message"
							aria-labelledby={ id }
							className={ cx(
								'p-3 overflow-x-auto overflow-y-hidden select-text',
								! isUser && 'pb-0',
								message.failedMessage
									? 'rounded border border-[#FACFD2] bg-[#F7EBEC]'
									: isUser && 'rounded-xl bg-a8c-gray-100'
							) }
						>
							<div className="relative">
								<span className="sr-only">
									{ isUser ? __( 'Your message' ) : __( 'Studio Assistant' ) },
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
						</div>
						{ message.content && (
							<MessageActions
								content={ message.content }
								isAssistant={ ! isUser }
								onRate={ onRate }
							/>
						) }
					</div>
				</div>
			</>
		);
	}
);
