import * as Sentry from '@sentry/react';
import { speak } from '@wordpress/a11y';
import {
	__unstableMotion as motion,
	__unstableAnimatePresence as AnimatePresence,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import Markdown, { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import createCodeComponent from './assistant-code-block';
import { MessageThinking } from './assistant-thinking';

export interface ChatMessageProps {
	children: React.ReactNode;
	isUser: boolean;
	isAssistantThinking?: boolean;
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
}

export const ChatMessage = ( {
	id,
	isAssistantThinking,
	messageId,
	isUser,
	className,
	projectPath,
	blocks,
	updateMessage,
	isUnauthenticated,
	children,
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
				isUser
					? 'justify-end ltr:md:ml-24 rtl:md:mr-24'
					: 'justify-start ltr:md:mr-24 rtl:md:ml-24',
				className
			) }
		>
			<motion.div
				key={ isAssistantThinking ? `thinking` : `content` }
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
					isUnauthenticated ? 'lg:max-w-[90%]' : 'lg:max-w-[70%]',
					! isUser ? 'bg-white' : 'bg-white/45'
				) }
			>
				<div className="relative">
					<span className="sr-only">
						{ isUser ? __( 'Your message' ) : __( 'Studio Assistant' ) },
					</span>
				</div>
				{ isAssistantThinking && (
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
					</motion.div>
				) : (
					children
				) }
			</motion.div>
		</motion.div>
	);
};

function Anchor( props: JSX.IntrinsicElements[ 'a' ] & ExtraProps ) {
	const { href } = props;
	const { node, className, ...filteredProps } = props;
	const { selectedSite, startServer, loadingServer } = useSiteDetails();

	return (
		<a
			{ ...filteredProps }
			className={ cx(
				className,
				selectedSite && loadingServer[ selectedSite.id ] && 'animate-pulse duration-100 cursor-wait'
			) }
			onClick={ async ( e ) => {
				if ( ! href ) {
					return;
				}

				e.preventDefault();

				const urlForStoppedSite =
					/^https?:\/\/localhost/.test( href ) && selectedSite && ! selectedSite.running;
				if ( urlForStoppedSite ) {
					speak( __( 'Starting the server before opening the site link' ) );
					await startServer( selectedSite?.id );
				}

				try {
					getIpcApi().openURL( href );
				} catch ( error ) {
					getIpcApi().showMessageBox( {
						type: 'error',
						message: __( 'Failed to open link' ),
						detail: __( 'We were unable to open the link. Please try again.' ),
						buttons: [ __( 'OK' ) ],
					} );
					Sentry.captureException( error );
				}
			} }
		/>
	);
}
