import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { clsx } from 'clsx';
import { CheckIcon, MinusIcon } from 'lucide-react';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Checkbox( {
	className,
	indeterminate,
	...props
}: ComponentProps< typeof BaseCheckbox.Root > ) {
	return (
		<BaseCheckbox.Root
			data-slot="checkbox"
			indeterminate={ indeterminate }
			className={ clsx( styles.checkbox, className ) }
			{ ...props }
		>
			<BaseCheckbox.Indicator className={ styles.indicator }>
				{ indeterminate ? <MinusIcon /> : <CheckIcon /> }
			</BaseCheckbox.Indicator>
		</BaseCheckbox.Root>
	);
}
