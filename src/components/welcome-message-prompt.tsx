import { cx } from '../lib/cx';

interface WelcomeMessagePromptProps {
	onClick?: () => void;
	children?: React.ReactNode;
	className?: string;
}

interface ExampleMessahgePromptProps {
	onClick?: () => void;
	children: React.ReactNode;
	className?: string;
}

export const WelcomeMessagePrompt = ( {
	onClick,
	children,
	className,
}: WelcomeMessagePromptProps ) => (
	<div className={ cx( 'flex mt-4' ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text'
			) }
			onClick={ onClick }
		>
			<p className="text-lg text-gray-600">Big burrito</p>
		</div>
	</div>
);
