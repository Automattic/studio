import { __ } from '@wordpress/i18n';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import Anchor from 'src/components/assistant-anchor';
import createCodeComponent from 'src/components/assistant-code-block';
import { cx } from 'src/lib/cx';
import { StudioCodeToolCall } from './studio-code-tool-call';
import type { ChatMessage } from './studio-code-types';

interface StudioCodeMessageProps {
	message: ChatMessage;
	siteId: string;
}

export function StudioCodeMessage( { message, siteId }: StudioCodeMessageProps ) {
	const isUser = message.role === 'user';

	return (
		<>
			<div className="h-4" />
			<div
				className={ cx(
					'flex',
					isUser
						? 'justify-end ltr:md:ml-24 rtl:md:mr-24'
						: 'justify-start ltr:md:mr-24 rtl:md:ml-24'
				) }
			>
				<div
					data-testid="studio-code-message"
					className={ cx(
						'inline-block p-3 rounded border overflow-x-auto overflow-y-hidden select-text lg:max-w-[70%]',
						isUser ? 'bg-frame' : 'bg-frame/45',
						'border-frame-border'
					) }
				>
					<div className="relative">
						<span className="sr-only">
							{ isUser ? __( 'Your message' ) : __( 'Studio Code' ) },
						</span>
					</div>
					{ isUser ? (
						<p className="whitespace-pre-wrap m-0">{ message.content }</p>
					) : (
						<>
							{ message.content && (
								<div className="assistant-markdown">
									<Markdown
										components={ {
											a: Anchor,
											code: createCodeComponent( {
												siteId,
												instanceId: 'studio-code',
											} ),
											img: () => null,
										} }
										remarkPlugins={ [ remarkGfm ] }
										rehypePlugins={ [ rehypeRaw ] }
									>
										{ message.content }
									</Markdown>
								</div>
							) }
							{ message.toolCalls.map( ( toolCall ) => (
								<StudioCodeToolCall key={ toolCall.id } toolCall={ toolCall } />
							) ) }
						</>
					) }
				</div>
			</div>
		</>
	);
}
