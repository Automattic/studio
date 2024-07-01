import { __unstableMotion as motion } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message } from '../hooks/use-assistant';
import { cx } from '../lib/cx';
import Anchor from './assistant-anchor';
import createCodeComponent from './assistant-code-block';
import { MessageThinking } from './assistant-thinking';

export interface ChatMessageProps {
	children: React.ReactNode;
	id: string;
	className?: string;
	siteId?: string;
	message: Message;
	updateMessage?: (
		id: number,
		content: string,
		output: string,
		status: 'success' | 'error',
		time: string
	) => void;
	isUnauthenticated?: boolean;
}

export const ChatMessage = ( {
	id,
	message,
	className,
	siteId,
	updateMessage,
	children,
	isUnauthenticated,
}: ChatMessageProps ) => {
	const bubbleVariants = {
		hidden: { opacity: 0, y: 20, scale: 0.95 },
		visible: { opacity: 1, y: 0, scale: 1 },
		exit: { opacity: 0, y: -20, scale: 0.95 },
	};

	return (
		<motion.div
			key="container"
			className={ cx(
				'flex mt-4',
				message.role === 'user'
					? 'justify-end ltr:md:ml-24 rtl:md:mr-24'
					: 'justify-start ltr:md:mr-24 rtl:md:ml-24',
				className
			) }
		>
			<motion.div
				key={ message.role === 'thinking' ? 'thinking' : 'content' }
				variants={ bubbleVariants }
				initial="hidden"
				animate="visible"
				exit="exit"
				transition={ {
					duration: 0.3,
				} }
				id={ id }
				role="group"
				data-testid="chat-message"
				aria-labelledby={ id }
				className={ cx(
					'inline-block p-3 rounded border border-gray-300 overflow-x-auto select-text',
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
				{ message.role === 'thinking' && (
					<motion.div key="thinking-container">
						<MessageThinking />
					</motion.div>
				) }
				{ typeof children === 'string' ? (
					<motion.div key="code" className="assistant-markdown">
						<Markdown
							components={ {
								a: Anchor,
								code: createCodeComponent( {
									blocks: message?.blocks,
									messageId: message.id,
									siteId,
									updateMessage,
								} ),
								img: () => null,
							} }
							remarkPlugins={ [ remarkGfm ] }
						>
							{ children }
						</Markdown>
					</motion.div>
				) : (
					children
				) }
			</motion.div>
		</motion.div>
	);
};
