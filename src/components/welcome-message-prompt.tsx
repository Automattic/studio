import { arrowRight } from '@wordpress/icons';
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

interface WelcomeComponentProps {
	onExampleClick: ( prompt: string ) => void;
	showExamplePrompts: boolean;
	messages: string[];
	examplePrompts: string[];
}

export const WelcomeMessagePrompt = ( { children, className }: WelcomeMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
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
	<div className={ cx( 'flex mt-2' ) }>
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

const WelcomeComponent = ( {
	onExampleClick,
	showExamplePrompts,
	messages,
	examplePrompts,
}: WelcomeComponentProps ) => {
	return (
		<div>
			{ messages.map( ( message, index ) => (
				<WelcomeMessagePrompt key={ index } className="welcome-message">
					{ message }
				</WelcomeMessagePrompt>
			) ) }
			{ showExamplePrompts &&
				examplePrompts.map( ( prompt, index ) => (
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
