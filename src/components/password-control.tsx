import { Icon } from '@wordpress/components';
import { seen, unseen } from '@wordpress/icons';
import { useState } from 'react';
import { cx } from 'src/lib/cx';

interface PasswordControlProps {
	id?: string;
	value: string;
	onChange: ( value: string ) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

const PasswordControl = ( {
	id,
	value,
	onChange,
	placeholder,
	disabled,
	className,
}: PasswordControlProps ) => {
	const [ isVisible, setIsVisible ] = useState( false );

	return (
		<div className={ cx( 'relative', className ) }>
			<input
				id={ id }
				type={ isVisible ? 'text' : 'password' }
				value={ value }
				onChange={ ( e ) => onChange( e.target.value ) }
				placeholder={ placeholder }
				disabled={ disabled }
				className={ cx(
					'w-full h-10 px-4 py-3 pr-10 rounded-sm border border-[#949494] outline-none',
					'focus:border-a8c-blue-50 focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blue-50',
					'transition-shadow transition-linear duration-100',
					disabled && 'bg-a8c-gray-100 text-a8c-gray-600 border-a8c-gray-400 cursor-not-allowed'
				) }
			/>
			<button
				type="button"
				onClick={ () => setIsVisible( ! isVisible ) }
				disabled={ disabled }
				className={ cx(
					'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded',
					'hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-a8c-blue-50',
					disabled && 'cursor-not-allowed opacity-50'
				) }
				aria-label={ isVisible ? 'Hide password' : 'Show password' }
			>
				<Icon icon={ isVisible ? unseen : seen } size={ 20 } className="text-gray-500" />
			</button>
		</div>
	);
};

export default PasswordControl;
