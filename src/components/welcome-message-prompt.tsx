import { __ } from '@wordpress/i18n';
import { arrowRight } from '@wordpress/icons';
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
}

interface WelcomeComponentProps {
	onExampleClick: ( prompt: string ) => void;
	showExamplePrompts: boolean;
	messages: string[];
	examplePrompts: string[];
}

export const WelcomeMessagePrompt = ( { id, children, className }: WelcomeMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
		<div
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
);

export const ExampleMessagePrompt = ( {
	onClick,
	children,
	className,
}: ExampleMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
		<Button
			variant="secondary"
			className={ cx( '!rounded lg:max-w-[70%]', className ) }
			onClick={ onClick }
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

const WelcomeComponent = ( {
	onExampleClick,
	showExamplePrompts,
	messages,
	examplePrompts,
}: WelcomeComponentProps ) => {
	return (
		<div>
			{ messages.map( ( message, index ) => (
				<WelcomeMessagePrompt
					key={ index }
					id={ `message-welcome-${ index }` }
					className="welcome-message"
				>
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
