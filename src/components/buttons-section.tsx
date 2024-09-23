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
		<div className="w-full">
			<h2 className="a8c-subtitle-small mb-3">{ title }</h2>
			<div className={ cx( 'gap-3', className || 'grid grid-cols-2 lg:grid-cols-3' ) }>
				{ buttonsArray.map( ( button, index ) => (
					<Button
						className={ button.className }
						key={ index }
						icon={ button.icon }
						iconSize={ 18 }
						onClick={ button.onClick }
						disabled={ button.disabled }
						variant="secondary"
						label={ button.label }
						truncate
					>
						{ button.label }
					</Button>
				) ) }
			</div>
		</div>
	);
}
