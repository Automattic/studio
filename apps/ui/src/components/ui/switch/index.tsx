import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Switch( {
	className,
	size = 'default',
	...props
}: ComponentProps< typeof BaseSwitch.Root > & { size?: 'sm' | 'default' } ) {
	return (
		<BaseSwitch.Root
			data-slot="switch"
			data-size={ size }
			className={ clsx( styles.switch, className ) }
			{ ...props }
		>
			<BaseSwitch.Thumb className={ styles.thumb } />
		</BaseSwitch.Root>
	);
}
