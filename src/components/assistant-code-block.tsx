import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, archive, edit, preformatted } from '@wordpress/icons';
import { useCallback, useEffect, useState } from 'react';
import { ExtraProps } from 'react-markdown';
import stripAnsi from 'strip-ansi';
import { Message as MessageType } from '../hooks/use-assistant';
import { useExecuteWPCLI } from '../hooks/use-execute-cli';
import { useFeatureFlags } from '../hooks/use-feature-flags';
import { useIsValidWpCliInline } from '../hooks/use-is-valid-wp-cli-inline';
import { useSiteDetails } from '../hooks/use-site-details';
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

	const { terminalWpCliEnabled } = useFeatureFlags();
	const { selectedSite } = useSiteDetails();
	if ( ! selectedSite ) {
		return null;
	}

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
				{ [ 'language-sh', 'language-bash' ].includes( props.className || '' ) && (
					<CopyTextButton
						icon={ preformatted }
						text={ content }
						label={ __( 'Copy and open terminal' ) }
						copyConfirmation={ __( 'Copied to clipboard' ) }
						showText={ true }
						variant="outlined"
						className="h-auto mr-2 !px-2.5 py-0.5 !p-[6px] font-sans select-none"
						iconSize={ 16 }
						onCopied={ async () => {
							try {
								await getIpcApi().openTerminalAtPath( selectedSite.path, {
									wpCliEnabled: terminalWpCliEnabled,
								} );
							} catch ( error ) {
								console.error( error );
							}
						} }
					></CopyTextButton>
				) }
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

function FileBlock( props: ContextProps & CodeBlockProps & { isDirectory?: boolean } ) {
	const {
		children,
		className,
		node,
		blocks,
		updateMessage,
		siteId,
		messageId,
		isDirectory,
		...htmlAttributes
	} = props;
	const content = String( children ).trim();
	const [ filePath, setFilePath ] = useState( '' );

	const openFileInIDE = useCallback( () => {
		if ( ! siteId || ! filePath ) {
			return;
		}
		getIpcApi().openFileInIDE( content, siteId );
	}, [ siteId, filePath, content ] );

	const openFileInFinder = useCallback( () => {
		if ( ! siteId || ! filePath ) {
			return;
		}
		getIpcApi().openLocalPath( filePath );
	}, [ siteId, filePath ] );

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
			onClick={ isDirectory ? openFileInFinder : openFileInIDE }
		>
			{ children }
			{ filePath && (
				<Icon icon={ isDirectory ? archive : edit } className="rtl:scale-x-[-1]" size={ 16 } />
			) }
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

	const isWPDirectory = ( content: string ) => {
		const wpPaths = [ 'wp-content', 'wp-includes', 'wp-admin' ];
		return wpPaths.some(
			( path ) => content.startsWith( path ) || content.startsWith( '/' + path )
		);
	};

	const inferContentType = () => {
		if ( /language-(\w+)/.exec( className || '' ) ) {
			return 'language';
		} else if ( isFilePath( content ) ) {
			return 'file';
		} else if ( isWPDirectory( content ) ) {
			return 'wp-directory';
		}
		return 'other';
	};

	switch ( inferContentType() ) {
		case 'language':
			return <LanguageBlock { ...props } />;
		case 'file':
			return <FileBlock { ...props } />;
		case 'wp-directory':
			return <FileBlock { ...props } isDirectory />;
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
