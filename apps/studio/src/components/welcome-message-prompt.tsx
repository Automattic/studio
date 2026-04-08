import { __ } from '@wordpress/i18n';
import { arrowRight } from '@wordpress/icons';
import React, { useRef, useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';

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
	disabled?: boolean;
	isLoading?: boolean;
}

const WelcomeMessagePrompt = React.forwardRef< HTMLDivElement, WelcomeMessagePromptProps >(
	( { id, children, className }, ref ) => (
		<div className={ cx( 'flex mt-2' ) }>
			<div
				ref={ ref }
				id={ id }
				role="group"
				aria-labelledby={ id }
				className={ cx(
					'inline-block p-3 rounded border border-frame-border lg:max-w-[70%] select-text bg-frame',
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

const ExampleMessagePrompt = ( {
	onClick,
	children,
	className,
	disabled,
}: ExampleMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
		<Button
			variant="secondary"
			className={ cx( '!rounded', className ) }
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
	(
		{ onExampleClick, showExamplePrompts, messages, examplePrompts, disabled, isLoading },
		ref
	) => {
		const [ showMore, setShowMore ] = useState( false );
		const lastMessageRef = useRef< HTMLDivElement >( null );

		// Determine the prompts to display (either first 3 or all)
		const displayedPrompts = showMore ? examplePrompts : examplePrompts.slice( 0, 3 );

		const handleShowMore = () => {
			setShowMore( true );
			setTimeout( () => {
				lastMessageRef.current?.scrollIntoView( { behavior: 'smooth' } );
			}, 100 );
		};

		if ( isLoading ) {
			return (
				<div ref={ ref } className="flex flex-col animate-pulse">
					<div className="flex mt-2">
						<div className="inline-block p-3 rounded border border-frame-border lg:max-w-[70%] bg-frame-surface h-16 w-96" />
					</div>
					<div className="flex mt-2">
						<div className="inline-block p-3 rounded border border-frame-border lg:max-w-[70%] bg-frame-surface h-12 w-72" />
					</div>
				</div>
			);
		}

		return (
			<div ref={ ref }>
				<div className="flex flex-col">
					{ messages.map( ( message, index ) => (
						<WelcomeMessagePrompt
							key={ message }
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
								<div key={ prompt } className="flex items-center">
									<ExampleMessagePrompt
										className="example-prompt"
										onClick={ () => onExampleClick( prompt ) }
										disabled={ disabled }
									>
										{ prompt }
									</ExampleMessagePrompt>
									{ showExamplePrompts &&
										! showMore &&
										examplePrompts.length > 3 &&
										index === displayedPrompts.length - 1 && (
											<div className="mt-2 ml-2">
												<Button
													variant="secondary"
													className="!text-frame-text-secondary [&:not(:focus)]:shadow-none"
													onClick={ handleShowMore }
												>
													{ __( 'More suggestions' ) }
												</Button>
											</div>
										) }
								</div>
							) ) }
						</div>
					) }
				</div>
			</div>
		);
	}
);

export default WelcomeComponent;
