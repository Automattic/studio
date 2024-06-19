import * as Sentry from '@sentry/react';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, copy } from '@wordpress/icons';
import React, { useState } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface MessageProps {
	id: string;
	children: React.ReactNode;
	isUser: boolean;
	className?: string;
}

interface InlineCLIProps {
	output: string;
	status: 'success' | 'error';
	time: string;
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
			variant="outlined"
			className="h-auto mr-2 !px-2.5 py-0.5 font-sans select-none"
			disabled={ disabled }
		>
			{ icon }
			<span className="ml-1">{ buttonLabel }</span>
		</Button>
	);
};

export const ChatMessage = ( { children, id, isUser, className }: MessageProps ) => {
	const [ cliOutput, setCliOutput ] = useState< string | null >( null );
	const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
	const [ cliTime, setCliTime ] = useState< string | null >( null );
	const [ isRunning, setIsRunning ] = useState( false );

	const handleExecute = () => {
		setIsRunning( true );
		setTimeout( () => {
			setCliOutput(
				`Installing Jetpack...\nUnpacking the package...\nInstalling the plugin...\nPlugin installed successfully.\nActivating 'jetpack'...\nPlugin 'jetpack' activated.\nSuccess: Installed 1 of 1 plugins.`
			);
			setCliStatus( 'success' );
			setCliTime( 'Completed in 2.3 seconds' );
			setIsRunning( false );
		}, 2300 );
	};

	const CodeBlock = ( props: JSX.IntrinsicElements[ 'code' ] & ExtraProps ) => {
		const { children, className } = props;
		const match = /language-(\w+)/.exec( className || '' );
		const content = String( children ).trim();

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
					{ /* <ActionButton
						primaryLabel={ __( 'Run' ) }
						secondaryLabel={ __( 'Run Again' ) }
						icon={ <ExecuteIcon /> }
						onClick={ handleExecute }
						disabled={ isRunning } */ }
				</div>
				{ isRunning && (
					<div className="p-3 flex justify-start items-center bg-[#2D3337] text-white">
						<Spinner className="!text-white [&>circle]:stroke-a8c-gray-60" />
						<span className="ml-2 font-sans">{ __( 'Running...' ) }</span>
					</div>
				) }
				{ ! isRunning && cliOutput && cliStatus && cliTime && (
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
						<Markdown components={ { a: Anchor, code: CodeBlock } } remarkPlugins={ [ remarkGfm ] }>
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
