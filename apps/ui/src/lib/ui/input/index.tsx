import { Input as BaseInput } from '@base-ui/react/input';
import { clsx } from 'clsx';
import { inputFocusHandlers } from './focus';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export function Input( {
	className,
	variant = 'default',
	endAdornment,
	...props
}: ComponentProps< typeof BaseInput > & {
	variant?: 'default' | 'group';
	endAdornment?: ReactNode;
} ) {
	const input = (
		<BaseInput
			data-slot="input"
			data-variant={ variant }
			data-adorned={ endAdornment ? true : undefined }
			className={ clsx( styles.input, className ) }
			{ ...props }
			{ ...inputFocusHandlers< HTMLInputElement >( props ) }
		/>
	);
	if ( ! endAdornment ) {
		return input;
	}
	return (
		<span className={ styles.adorned }>
			{ input }
			<span className={ styles.adornment }>{ endAdornment }</span>
		</span>
	);
}
