import { __ } from '@wordpress/i18n';
import { arrowRight } from '@wordpress/icons';
import { cx } from '../lib/cx';

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
	disabled,
}: ExampleMessagePromptProps ) => (
	<div className={ cx( 'flex mt-2' ) }>
		<div
			aria-disabled={ disabled }
			className={ cx(
				'inline-block px-3 py-2 rounded border border-gray-300 lg:max-w-[70%] ',
				className,
				disabled
					? 'cursor-not-allowed opacity-30'
					: 'select-text cursor-pointer focus:border-a8c-blueberry hover:border-a8c-blueberry hover:text-a8c-blueberry hover:fill-a8c-blueberry'
			) }
			onClick={ () => {
				if ( onClick && ! disabled ) {
					onClick();
				}
			} }
			role="button"
		>
			<div className="assistant-markdown flex items-center">
				<span className={ cx( 'mr-2 w-4 h-4 flex items-center justify-center' ) }>
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
	disabled,
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
						disabled={ disabled }
					>
						{ prompt }
					</ExampleMessagePrompt>
				) ) }
		</div>
	);
};

export default WelcomeComponent;
