import { __ } from '@wordpress/i18n';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/cx';
import Anchor from './assistant-anchor';
import createCodeComponent from './assistant-code-block';

export interface ChatMessageProps {
	children: React.ReactNode;
	isUser: boolean;
	id: string;
	messageId?: number;
	className?: string;
	projectPath?: string;
	siteId?: string;
	blocks?: {
		cliOutput?: string;
		cliStatus?: 'success' | 'error';
		cliTime?: string;
		codeBlockContent?: string;
	}[];
	updateMessage?: (
		id: number,
		content: string,
		output: string,
		status: 'success' | 'error',
		time: string
	) => void;
	isUnauthenticated?: boolean;
	failedMessage?: boolean;
}

export const ChatMessage = ( {
	children,
	id,
	messageId,
	isUser,
	className,
	projectPath,
	blocks,
	updateMessage,
	isUnauthenticated,
	failedMessage,
}: ChatMessageProps ) => {
	return (
		<div
			className={ cx(
				'flex mt-4',
				isUser
					? 'justify-end ltr:md:ml-24 rtl:md:mr-24'
					: 'justify-start ltr:md:mr-24 rtl:md:ml-24',
				className
			) }
		>
			<div
				id={ id }
				role="group"
				aria-labelledby={ id }
				className={ cx(
					'inline-block p-3 rounded border overflow-x-auto select-text',
					isUnauthenticated ? 'lg:max-w-[90%]' : 'lg:max-w-[70%]', // Apply different max-width for unauthenticated view
					! isUser ? 'bg-white' : 'bg-white/45',
					failedMessage ? 'border-[#FACFD2] bg-[#F7EBEC]' : 'border-gray-300'
				) }
			>
				<div className="relative">
					<span className="sr-only">
						{ isUser ? __( 'Your message' ) : __( 'Studio Assistant' ) },
					</span>
				</div>
				{ typeof children === 'string' ? (
					<div className="assistant-markdown">
						<Markdown
							components={ {
								a: Anchor,
								code: createCodeComponent( {
									blocks,
									messageId,
									projectPath,
									updateMessage,
								} ),
								img: () => null,
							} }
							remarkPlugins={ [ remarkGfm ] }
						>
							{ children }
						</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};
