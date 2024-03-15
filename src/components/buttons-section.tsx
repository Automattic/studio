import { cx } from '../lib/cx';
import Button from './button';

export interface ButtonsSectionProps {
	buttonsArray: Array< {
		label: string;
		icon: JSX.Element;
		onClick: () => void;
		className?: string;
		disabled?: boolean;
	} >;
	title: string;
	className?: string;
}

export function ButtonsSection( { buttonsArray, title, className = '' }: ButtonsSectionProps ) {
	return (
		<div className="w-full max-w-96">
			<div className="a8c-subtitle-small mb-3">{ title }</div>
			<div className={ cx( 'gap-3', className || 'grid grid-cols-3' ) }>
				{ buttonsArray.map( ( button, index ) => (
					<Button
						className={ cx(
							'rounded-sm border border-solid border-a8c-gray-5 a8c-body-small text-black hover:border-a8c-blueberry disabled:border-a8c-gray-5',
							button.className
						) }
						key={ index }
						icon={ button.icon }
						iconSize={ 18 }
						onClick={ button.onClick }
						disabled={ button.disabled }
					>
						{ button.label }
					</Button>
				) ) }
			</div>
		</div>
	);
}
