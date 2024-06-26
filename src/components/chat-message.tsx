import * as Sentry from '@sentry/react';
import { speak } from '@wordpress/a11y';
import {
	__unstableMotion as motion,
	Spinner,
	__unstableAnimatePresence as AnimatePresence,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import stripAnsi from 'strip-ansi';
import { useExecuteWPCLI } from '../hooks/use-execute-cli';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { CopyTextButton } from './copy-text-button';
import { ExecuteIcon } from './icons/execute';

interface ChatMessageProps {
	children: React.ReactNode | string;
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

interface InlineCLIProps {
	output?: string;
	status?: 'success' | 'error';
	time?: string | null;
}

const InlineCLI = ( { output, status, time }: InlineCLIProps ) => (
	<div className="p-3 bg-[#2D3337]">
		<div className="flex justify-between mb-2 font-sans">
			<span className={ status === 'success' ? 'text-[#63CE68]' : 'text-[#E66D6C]' }>
				{ status === 'success' ? __( 'Success' ) : __( 'Error' ) }
			</span>
			<span className="text-gray-400">{ time }</span>
		</div>
		<pre className="text-white !bg-transparent !m-0 !px-0">
			<code className="!bg-transparent !mx-0 !px-0 !text-nowrap">{ output }</code>
		</pre>
	</div>
);

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
	const CodeBlock = ( props: JSX.IntrinsicElements[ 'code' ] & ExtraProps ) => {
		const content = String( props.children ).trim();
		const containsWPCommand = /\bwp\s/.test( content );
		const wpCommandCount = ( content.match( /\bwp\s/g ) || [] ).length;
		const containsSingleWPCommand = wpCommandCount === 1;
		const containsAngleBrackets = /<.*>/.test( content );

		const {
			cliOutput,
			cliStatus,
			cliTime,
			isRunning,
			handleExecute,
			setCliOutput,
			setCliStatus,
			setCliTime,
		} = useExecuteWPCLI( content, projectPath, updateMessage, messageId );

		useEffect( () => {
			if ( blocks ) {
				const block = blocks?.find( ( block ) => block.codeBlockContent === content );
				if ( block ) {
					setCliOutput( block?.cliOutput ? stripAnsi( block.cliOutput ) : null );
					setCliStatus( block?.cliStatus ?? null );
					setCliTime( block?.cliTime ?? null );
				}
			}
		}, [ cliOutput, content, setCliOutput, setCliStatus, setCliTime ] );

		const { children, className } = props;
		const match = /language-(\w+)/.exec( className || '' );
		const { node, ...propsSansNode } = props;
		return match ? (
			<>
				<div className="p-3">
					<code className={ className } { ...propsSansNode }>
						{ children }
					</code>
				</div>
				<div className="p-3 pt-1 flex justify-start items-center">
					<CopyTextButton
						text={ content }
						label={ __( 'Copy' ) }
						copyConfirmation={ __( 'Copied!' ) }
						showText={ true }
						variant="outlined"
						className="h-auto mr-2 !px-2.5 py-0.5 !p-[6px] font-sans select-none"
						iconSize={ 16 }
					></CopyTextButton>
					{ containsWPCommand && containsSingleWPCommand && ! containsAngleBrackets && (
						<Button
							icon={ <ExecuteIcon /> }
							onClick={ handleExecute }
							disabled={ isRunning }
							variant="outlined"
							className="h-auto mr-2 !px-2.5 py-0.5 font-sans select-none"
						>
							{ cliOutput ? __( 'Run again' ) : __( 'Run' ) }
						</Button>
					) }
				</div>
				{ isRunning && (
					<div className="p-3 flex justify-start items-center bg-[#2D3337] text-white">
						<Spinner className="!text-white [&>circle]:stroke-a8c-gray-60" />
						<span className="ml-2 font-sans">{ __( 'Running...' ) }</span>
					</div>
				) }
				{ ! isRunning && cliOutput && cliStatus && (
					<InlineCLI output={ cliOutput } status={ cliStatus } time={ cliTime } />
				) }
			</>
		) : (
			<code className={ className } { ...propsSansNode }>
				{ children }
			</code>
		);
	};
	const bubbleVariants = {
		hidden: { opacity: 0, y: 20, scale: 0.95 },
		visible: { opacity: 1, y: 0, scale: 1 },
		exit: { opacity: 0, y: -20, scale: 0.95 },
	};

	return (
		<motion.div
			className={ cx(
				'flex mt-4',
				isUser ? 'justify-end md:ml-24' : 'justify-start md:mr-24',
				className
			) }
			layout="position"
		>
			<AnimatePresence mode="wait">
				<motion.div
					key={ isAssistantThinking ? 'thinking' : 'content' }
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
					{ isAssistantThinking && <MessageThinking /> }
					{ typeof children === 'string' ? (
						<div className="assistant-markdown">
							<Markdown
								components={ { a: Anchor, code: CodeBlock, img: () => null } }
								remarkPlugins={ [ remarkGfm ] }
							>
								{ children }
							</Markdown>
						</div>
					) : (
						children
					) }
				</motion.div>
			</AnimatePresence>
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
