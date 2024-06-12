import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, copy } from '@wordpress/icons';
import { useCallback, useEffect, useState } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import stripAnsi from 'strip-ansi';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ExecuteIcon } from './icons/execute';

interface MessageProps {
	children: React.ReactNode;
	isUser: boolean;
	id?: number;
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

const ActionButton = ( {
	primaryLabel,
	secondaryLabel,
	icon,
	onClick,
	timeout,
	disabled,
}: {
	primaryLabel: string;
	secondaryLabel: string;
	icon: JSX.Element;
	onClick: () => void;
	timeout?: number;
	disabled?: boolean;
} ) => {
	const [ buttonLabel, setButtonLabel ] = useState( primaryLabel );

	const handleClick = () => {
		onClick();
		setButtonLabel( secondaryLabel );
		if ( timeout ) {
			setTimeout( () => {
				setButtonLabel( primaryLabel );
			}, timeout );
		}
	};

	return (
		<Button
			onClick={ handleClick }
			variant="tertiary"
			className="mr-2 font-sans select-none"
			disabled={ disabled }
		>
			{ icon }
			<span className="ml-1">{ buttonLabel }</span>
		</Button>
	);
};

export const Message = ( {
	children,
	id,
	isUser,
	className,
	projectPath,
	blocks,
	updateMessage,
}: MessageProps ) => {
	const CodeBlock = ( props: JSX.IntrinsicElements[ 'code' ] & ExtraProps ) => {
		const [ cliOutput, setCliOutput ] = useState< string | null >( null );
		const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
		const [ cliTime, setCliTime ] = useState< string | null >( null );

		const [ isRunning, setIsRunning ] = useState( false );

		const content = String( props.children ).trim();
		const containsWPCommand = /\bwp\s/.test( content );
		const wpCommandCount = ( content.match( /\bwp\s/g ) || [] ).length;
		const containsSingleWPCommand = wpCommandCount === 1;

		useEffect( () => {
			if ( blocks ) {
				const block = blocks?.find( ( block ) => block.codeBlockContent === content );
				if ( block ) {
					setCliOutput( block?.cliOutput ? stripAnsi( block.cliOutput ) : null );
					setCliStatus( block?.cliStatus ?? null );
					setCliTime( block?.cliTime ?? null );
				}
			}
		}, [ cliOutput, content ] );

		const handleExecute = useCallback( async () => {
			setIsRunning( true );
			const startTime = Date.now();
			const args = content.split( ' ' ).slice( 1 );
			const result = await getIpcApi().executeWPCLiInline( {
				projectPath: projectPath || '',
				args,
			} );

			setTimeout( () => {
				const msTime = Date.now() - startTime;
				if ( result.stderr ) {
					setCliOutput( result.stderr );
					setCliStatus( 'error' );
				} else {
					setCliOutput( result.stdout );
					setCliStatus( 'success' );
				}
				const completedIn = sprintf(
					__( 'Completed in %s seconds' ),
					( msTime / 1000 ).toFixed( 2 )
				);
				setCliTime( completedIn );
				setIsRunning( false );

				if ( updateMessage && id !== undefined ) {
					updateMessage(
						id,
						content,
						result.stdout || result.stderr,
						result.stderr ? 'error' : 'success',
						completedIn || ''
					);
				}
			}, 2300 );
		}, [ content ] );

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
					<ActionButton
						primaryLabel={ __( 'Copy' ) }
						secondaryLabel={ __( 'Copied' ) }
						icon={ <Icon icon={ copy } size={ 16 } /> }
						onClick={ () => getIpcApi().copyText( content ) }
						timeout={ 2000 }
					/>
					{ containsWPCommand && containsSingleWPCommand && (
						<ActionButton
							primaryLabel={ __( 'Run' ) }
							secondaryLabel={ __( 'Run Again' ) }
							icon={ <ExecuteIcon /> }
							onClick={ handleExecute }
							disabled={ isRunning }
						/>
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

	return (
		<div
			className={ cx(
				'flex mt-4',
				isUser ? 'justify-end md:ml-24' : 'justify-start md:mr-24',
				className
			) }
		>
			<div
				className={ cx(
					'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text',
					! isUser ? 'bg-white' : 'bg-white/45'
				) }
			>
				{ typeof children === 'string' ? (
					<div className="assistant-markdown">
						<Markdown components={ { code: CodeBlock } }>{ children }</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};
