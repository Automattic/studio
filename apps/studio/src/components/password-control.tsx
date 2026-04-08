import { Icon } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
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
				autoComplete="new-password"
				className={ cx(
					'w-full h-10 px-4 py-3 pr-10 rounded-sm border border-frame-border bg-frame-surface text-frame-text outline-none',
					'focus:border-a8c-blue-50 focus:shadow-[0_0_0_0.5px] focus:shadow-a8c-blue-50',
					'transition-shadow transition-linear duration-100',
					disabled && 'opacity-60 cursor-not-allowed'
				) }
			/>
			<button
				type="button"
				onClick={ () => setIsVisible( ! isVisible ) }
				disabled={ disabled }
				className={ cx(
					'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded',
					'hover:bg-frame-surface-alt focus:outline-none focus:ring-2 focus:ring-a8c-blue-50',
					disabled && 'cursor-not-allowed opacity-50'
				) }
				aria-label={ isVisible ? __( 'Hide password' ) : __( 'Show password' ) }
			>
				<Icon
					icon={ isVisible ? unseen : seen }
					size={ 20 }
					className="fill-frame-text-secondary"
				/>
			</button>
		</div>
	);
};

export default PasswordControl;
