import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { clsx } from 'clsx';
import { checkIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Checkbox( { className, ...props }: ComponentProps< typeof BaseCheckbox.Root > ) {
	return (
		<BaseCheckbox.Root
			data-slot="checkbox"
			className={ clsx( styles.checkbox, className ) }
			{ ...props }
		>
			<BaseCheckbox.Indicator className={ styles.indicator }>{ checkIcon }</BaseCheckbox.Indicator>
		</BaseCheckbox.Root>
	);
}
