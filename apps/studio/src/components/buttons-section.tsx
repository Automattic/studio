import { ReactNode } from 'react';
import { cx } from 'src/lib/cx';

export interface ButtonsSectionProps {
	buttonsArray: Array< {
		label: string;
		icon: ReactNode;
		onClick: () => void;
		className?: string;
		disabled?: boolean;
	} >;
	title: string;
	className?: string;
}

export function ButtonsSection( { buttonsArray, title, className = '' }: ButtonsSectionProps ) {
	return (
		<div className="w-full">
			<h2 className="a8c-subtitle-small mb-3">{ title }</h2>
			<div
				className={ cx( 'grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1', className ) }
			>
				{ buttonsArray.map( ( button, index ) => (
					<button
						key={ index }
						onClick={ button.onClick }
						disabled={ button.disabled }
						aria-label={ button.label }
						className={ cx(
							'flex flex-col items-center justify-center gap-1.5 py-4 px-2 rounded-md',
							'text-frame-text-secondary transition-colors',
							'hover:text-frame-theme hover:bg-a8c-gray-0',
							'disabled:opacity-50 disabled:cursor-not-allowed',
							button.className
						) }
					>
						<span className="w-5 h-5 flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">
							{ button.icon }
						</span>
						<span className="text-xs truncate max-w-full">{ button.label }</span>
					</button>
				) ) }
			</div>
		</div>
	);
}
