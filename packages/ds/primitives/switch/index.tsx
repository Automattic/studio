import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Switch( { className, ...props }: ComponentProps< typeof BaseSwitch.Root > ) {
	return (
		<BaseSwitch.Root data-slot="switch" className={ clsx( styles.switch, className ) } { ...props }>
			<BaseSwitch.Thumb className={ styles.thumb } />
		</BaseSwitch.Root>
	);
}
