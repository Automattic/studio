import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, edit } from '@wordpress/icons';
import { useCallback, useEffect, useState } from 'react';
import { ExtraProps } from 'react-markdown';
import stripAnsi from 'strip-ansi';
import { Message as MessageType } from '../hooks/use-assistant';
import { useCheckInstalledApps } from '../hooks/use-check-installed-apps';
import { useExecuteWPCLI } from '../hooks/use-execute-cli';
import { useIsValidWpCliInline } from '../hooks/use-is-valid-wp-cli-inline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
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

const LanguageBlock = ( props: ContextProps & CodeBlockProps ) => {
	const { children, className, node, blocks, updateMessage, siteId, messageId, ...htmlAttributes } =
		props;
	const content = String( children ).trim();
	const isValidWpCliCommand = useIsValidWpCliInline( content );
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

	return (
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
	);
};

function FileBlock( props: ContextProps & CodeBlockProps ) {
	const { children, className, node, blocks, updateMessage, siteId, messageId, ...htmlAttributes } =
		props;
	const content = String( children ).trim();
	const installedApps = useCheckInstalledApps();
	const [ filePath, setFilePath ] = useState( '' );

	const openFileInIDE = useCallback( () => {
		if ( ! filePath ) {
			return;
		}
		const { vscode, phpstorm } = installedApps;
		if ( vscode ) {
			getIpcApi().openURL( `vscode://file/${ filePath }?windowId=_blank` );
		} else if ( phpstorm ) {
			getIpcApi().openURL( `phpstorm://open?file=${ filePath }` );
		}
	}, [ installedApps, filePath ] );

	useEffect( () => {
		if ( ! siteId || ! content ) {
			return;
		}
		getIpcApi()
			.getAbsolutePathFromSite( siteId, content )
			.then( ( path ) => {
				if ( path ) {
					setFilePath( path );
				}
			} );
	}, [ siteId, content ] );

	return (
		<code
			{ ...htmlAttributes }
			className={ cx( className, filePath && 'file-block' ) }
			onClick={ openFileInIDE }
		>
			{ children }
			{ filePath && <Icon icon={ edit } className="rtl:scale-x-[-1]" size={ 16 } /> }
		</code>
	);
}

function CodeBlock( props: ContextProps & CodeBlockProps ) {
	const { children, className } = props;
	const content = String( children ).trim();
	const { node, blocks, updateMessage, siteId, messageId, ...htmlAttributes } = props;

	const isFilePath = ( content: string ) => {
		const fileExtensions = [
			'.js',
			'.css',
			'.html',
			'.php',
			'.jsx',
			'.tsx',
			'.scss',
			'.less',
			'.log',
			'.md',
			'.json',
			'.txt',
			'.xml',
			'.yaml',
			'.yml',
			'.ini',
			'.env',
			'.sql',
		];
		return fileExtensions.some( ( ext ) => content.toLowerCase().endsWith( ext ) );
	};

	const inferContentType = () => {
		if ( /language-(\w+)/.exec( className || '' ) ) {
			return 'language';
		}
		if ( isFilePath( content ) ) {
			return 'file';
		}
		return 'other';
	};

	switch ( inferContentType() ) {
		case 'language':
			return <LanguageBlock { ...props } />;
		case 'file':
			return <FileBlock { ...props } />;
		default:
			return (
				<code className={ className } { ...htmlAttributes }>
					{ children }
				</code>
			);
	}
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
