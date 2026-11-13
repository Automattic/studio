import { Radio as BaseRadio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { clsx } from 'clsx';
import styles from './style.module.css';

export function RadioGroup< Value >( { className, ...props }: BaseRadioGroup.Props< Value > ) {
	return (
		<BaseRadioGroup
			data-slot="radio-group"
			className={ clsx( styles.group, className ) }
			{ ...props }
		/>
	);
}

export function RadioGroupItem< Value >( { className, ...props }: BaseRadio.Root.Props< Value > ) {
	return (
		<BaseRadio.Root
			data-slot="radio-group-item"
			className={ clsx( styles.item, className ) }
			{ ...props }
		>
			<BaseRadio.Indicator className={ styles.indicator } />
		</BaseRadio.Root>
	);
}
