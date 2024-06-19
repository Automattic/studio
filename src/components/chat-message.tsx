import * as Sentry from '@sentry/react';
import {
	__unstableMotion as motion,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import stripAnsi from 'strip-ansi';
import { useExecuteWPCLI } from '../hooks/use-execute-cli';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { CopyTextButton } from './copy-text-button';
import { ExecuteIcon } from './icons/execute';

interface ChatMessageProps {
	children: React.ReactNode;
	isUser: boolean;
	id?: string;
	isAssistantThinking?: boolean;
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
			<code className="!bg-transparent !mx-0 !px-0">{ output }</code>
		</pre>
	</div>
);

export const ChatMessage = ( {
	children,
	id,
	isAssistantThinking,
	messageId,
	isUser,
	className,
	projectPath,
	blocks,
	updateMessage,
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
		return match ? (
			<>
				<div className="p-3">
					<code className={ className } { ...props }>
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
			<div className="inline-block">
				<code className={ className } { ...props }>
					{ children }
				</code>
			</div>
		);
	};

	const exitAnimation = () => {
		if ( isAssistantThinking ) {
			return {
				opacity: 0,
				transition: { duration: 0.2 },
				y: -10,
			};
		}

		return { opacity: 0, transition: { duration: 0 } };
	};

	return (
		<motion.div
			layout="position"
			initial={ {
				y: 120,
				opacity: 0,
				transition: { duration: 0.3 },
			} }
			exit={ exitAnimation() }
			animate={ {
				y: 0,
				opacity: 1,
				transition: { duration: 0.3 },
			} }
		>
			<div
				className={ cx(
					'flex mt-4',
					isUser ? 'justify-end md:ml-24' : 'justify-start md:mr-24',
					className
				) }
			>
				<div
					id={ id }
					role="group"
					aria-labelledby={ id }
					className={ cx(
						'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] overflow-x-auto select-text',
						! isUser ? 'bg-white' : 'bg-white/45'
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
								components={ { a: Anchor, code: CodeBlock } }
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
		</motion.div>
	);
};

function Anchor( props: JSX.IntrinsicElements[ 'a' ] & ExtraProps ) {
	const { href } = props;

	return (
		<a
			{ ...props }
			onClick={ ( e ) => {
				if ( ! href ) {
					return;
				}

				e.preventDefault();
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
