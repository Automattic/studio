import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Checkbox( { className, ...props }: ComponentProps< typeof BaseCheckbox.Root > ) {
	return (
		<BaseCheckbox.Root
			data-slot="checkbox"
			className={ clsx( styles.checkbox, className ) }
			{ ...props }
		>
			<BaseCheckbox.Indicator className={ styles.indicator }>
				<CheckIcon />
			</BaseCheckbox.Indicator>
		</BaseCheckbox.Root>
	);
}
