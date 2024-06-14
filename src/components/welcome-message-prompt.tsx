import { arrowRight } from '@wordpress/icons';
import { useEffect } from 'react';
import { useFetchWelcomeMessages } from '../hooks/use-fetch-welcome-messages';
import { cx } from '../lib/cx';

interface WelcomeMessagePromptProps {
	children?: React.ReactNode;
	className?: string;
}

interface ExampleMessagePromptProps {
	onClick?: () => void;
	children: React.ReactNode;
	className?: string;
}

export const WelcomeMessagePrompt = ( { children, className }: WelcomeMessagePromptProps ) => (
	<div className={ cx( 'flex mt-4' ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text bg-white',
				className
			) }
		>
			<div className="assistant-markdown">
				<p>{ children }</p>
			</div>
		</div>
	</div>
);

export const ExampleMessagePrompt = ( {
	onClick,
	children,
	className,
}: ExampleMessagePromptProps ) => (
	<div className={ cx( 'flex mt-4' ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text cursor-pointer',
				className
			) }
			onClick={ onClick }
			role="button"
		>
			<div className="assistant-markdown flex items-center">
				<span className={ cx( 'mr-2', 'w-4 h-4 flex items-center justify-center' ) }>
					{ arrowRight }
				</span>
				<p className="inline">{ children }</p>
			</div>
		</div>
	</div>
);

const WelcomeComponent = ( { onExampleClick }: { onExampleClick: ( prompt: string ) => void } ) => {
	const { messages, examplePrompts, fetchWelcomeMessages } = useFetchWelcomeMessages();

	useEffect( () => {
		fetchWelcomeMessages();
	}, [ fetchWelcomeMessages ] );

	return (
		<div>
			{ messages.map( ( message, index ) => (
				<WelcomeMessagePrompt key={ index } className="welcome-message">
					{ message }
				</WelcomeMessagePrompt>
			) ) }
			{ examplePrompts.map( ( prompt, index ) => (
				<ExampleMessagePrompt
					key={ index }
					className="example-prompt"
					onClick={ () => onExampleClick( prompt ) }
				>
					{ prompt }
				</ExampleMessagePrompt>
			) ) }
		</div>
	);
};
export default WelcomeComponent;
