import { clsx } from 'clsx';
import { inputFocusHandlers } from '@/lib/ui/input/focus';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Textarea( {
	className,
	variant = 'default',
	size = 'default',
	sizing = 'content',
	...props
}: ComponentProps< 'textarea' > & {
	variant?: 'default' | 'group';
	size?: 'default' | 'sm';
	sizing?: 'content' | 'fixed';
} ) {
	return (
		<textarea
			data-slot="textarea"
			data-variant={ variant }
			data-size={ size }
			data-sizing={ sizing }
			className={ clsx( styles.textarea, className ) }
			{ ...props }
			{ ...inputFocusHandlers< HTMLTextAreaElement >( props ) }
		/>
	);
}
