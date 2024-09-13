import { __ } from '@wordpress/i18n';
import { arrowRight } from '@wordpress/icons';
import React, { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import Button from './button';

interface WelcomeMessagePromptProps {
	children?: React.ReactNode;
	id: string;
	className?: string;
}

interface ExampleMessagePromptProps {
	onClick?: () => void;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
}

interface WelcomeComponentProps {
	onExampleClick: ( prompt: string ) => void;
	showExamplePrompts: boolean;
	messages: string[];
	examplePrompts: string[];
	siteId: string;
	disabled?: boolean;
}

export const WelcomeMessagePrompt = React.forwardRef< HTMLDivElement, WelcomeMessagePromptProps >(
	( { id, children, className }, ref ) => (
		<div className={ cx( 'flex mt-2' ) }>
			<div
				ref={ ref }
				id={ id }
				role="group"
				aria-labelledby={ id }
				className={ cx(
					'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text bg-white',
					className
				) }
			>
				<div className="relative">
					<span className="sr-only">{ __( 'Studio Assistant' ) },</span>
				</div>
				<div className="assistant-markdown">
					<p>{ children }</p>
				</div>
			</div>
		</div>
	)
);

export const ExampleMessagePrompt = ( {
	onClick,
	children,
	className,
	disabled,
}: ExampleMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
		<Button
			variant="secondary"
			className={ cx( '!rounded lg:max-w-[70%]', className ) }
			onClick={ onClick }
			disabled={ disabled }
		>
			<div className="assistant-markdown flex items-center">
				<span className={ cx( 'mr-2 w-4 h-4 flex items-center justify-center' ) }>
					{ arrowRight }
				</span>
				<p className="inline">{ children }</p>
			</div>
		</Button>
	</div>
);

const WelcomeComponent = React.forwardRef< HTMLDivElement, WelcomeComponentProps >(
	( { onExampleClick, showExamplePrompts, messages, examplePrompts, siteId, disabled }, ref ) => {
		const [ showMore, setShowMore ] = useState( false );
		const lastMessageRef = useRef< HTMLDivElement >( null );

		// Determine the prompts to display (either first 3 or all)
		const displayedPrompts = showMore ? examplePrompts : examplePrompts.slice( 0, 3 );

		useEffect( () => {
			setShowMore( false );
		}, [ siteId ] );

		const handleShowMore = () => {
			setShowMore( true );
			setTimeout( () => {
				lastMessageRef.current?.scrollIntoView( { behavior: 'smooth' } );
			}, 100 );
		};

		return (
			<div ref={ ref }>
				<div className="flex flex-col">
					{ messages.map( ( message, index ) => (
						<WelcomeMessagePrompt
							key={ index }
							id={ `message-welcome-${ index }` }
							className="welcome-message"
							ref={ index === messages.length - 1 ? lastMessageRef : null }
						>
							{ message }
						</WelcomeMessagePrompt>
					) ) }
				</div>

				<div className="flex flex-col">
					{ showExamplePrompts && (
						<div className="flex-grow">
							{ displayedPrompts.map( ( prompt, index ) => (
								<ExampleMessagePrompt
									key={ index }
									className="example-prompt"
									onClick={ () => onExampleClick( prompt ) }
									disabled={ disabled }
								>
									{ prompt }
								</ExampleMessagePrompt>
							) ) }
						</div>
					) }

					{ showExamplePrompts && ! showMore && examplePrompts.length > 3 && (
						<div className="flex mt-[-2.5rem] ml-[34%] pt-1">
							<Button
								variant="secondary"
								className="lg:max-w-[30%] !text-a8c-gray-50 !shadow-none"
								onClick={ handleShowMore }
							>
								{ __( 'More suggestions' ) }
							</Button>
						</div>
					) }
				</div>
			</div>
		);
	}
);

export default WelcomeComponent;
