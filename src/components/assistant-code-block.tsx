import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { ExtraProps } from 'react-markdown';
import stripAnsi from 'strip-ansi';
import { Message as MessageType } from '../hooks/use-assistant';
import { useExecuteWPCLI } from '../hooks/use-execute-cli';
import { useIsValidWpCliInline } from '../hooks/use-is-valid-wp-cli-inline';
import Button from './button';
import { ChatMessageProps } from './chat-message';
import { CopyTextButton } from './copy-text-button';
import { ExecuteIcon } from './icons/execute';

type ContextProps = Pick< MessageType, 'blocks' > &
	Pick< ChatMessageProps, 'updateMessage' | 'siteId' > & { messageId?: number };

type CodeBlockProps = JSX.IntrinsicElements[ 'code' ] & ExtraProps;

export default function createCodeComponent( contextProps: ContextProps ) {
	return ( props: CodeBlockProps ) => <CodeBlock { ...contextProps } { ...props } />;
}

function CodeBlock( props: ContextProps & CodeBlockProps ) {
	const content = String( props.children ).trim();
	const isValidWpCliCommand = useIsValidWpCliInline( content );
	const { node, blocks, updateMessage, siteId, messageId, ...htmlAttributes } = props;
	const {
		cliOutput,
		cliStatus,
		cliTime,
		isRunning,
		handleExecute,
		setCliOutput,
		setCliStatus,
		setCliTime,
	} = useExecuteWPCLI( content, siteId, updateMessage, messageId );

	useEffect( () => {
		if ( blocks ) {
			const block = blocks?.find( ( block ) => block.codeBlockContent === content );
			if ( block ) {
				setCliOutput( block?.cliOutput ? stripAnsi( block.cliOutput ) : null );
				setCliStatus( block?.cliStatus ?? null );
				setCliTime( block?.cliTime ?? null );
			}
		}
	}, [ blocks, cliOutput, content, setCliOutput, setCliStatus, setCliTime ] );

	const { children, className } = props;
	const match = /language-(\w+)/.exec( className || '' );
	return match ? (
		<>
			<div className="p-3">
				<code className={ className } { ...htmlAttributes }>
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
				{ isValidWpCliCommand && (
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
					<Spinner className="!text-white [&>circle]:stroke-a8c-gray-60 !mt-0" />
					<span className="ml-2 font-sans">{ __( 'Running...' ) }</span>
				</div>
			) }
			{ ! isRunning && cliOutput && cliStatus && (
				<InlineCLI output={ cliOutput } status={ cliStatus } time={ cliTime } />
			) }
		</>
	) : (
		<code className={ className } { ...htmlAttributes }>
			{ children }
		</code>
	);
}

interface InlineCLIProps {
	output?: string;
	status?: 'success' | 'error';
	time?: string | null;
}

function InlineCLI( { output, status, time }: InlineCLIProps ) {
	return (
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
}
