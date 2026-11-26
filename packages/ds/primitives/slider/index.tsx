import { Slider as BaseSlider } from '@base-ui/react/slider';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** A horizontal slider with one thumb. */
export function Slider( {
	className,
	min = 0,
	max = 100,
	'aria-label': label,
	...props
}: ComponentProps< typeof BaseSlider.Root > ) {
	return (
		<BaseSlider.Root
			data-slot="slider"
			className={ clsx( styles.slider, className ) }
			min={ min }
			max={ max }
			thumbAlignment="edge"
			{ ...props }
		>
			<BaseSlider.Control className={ styles.control }>
				<BaseSlider.Track className={ styles.track }>
					<BaseSlider.Indicator className={ styles.indicator } />
				</BaseSlider.Track>
				<BaseSlider.Thumb className={ styles.thumb } aria-label={ label } />
			</BaseSlider.Control>
		</BaseSlider.Root>
	);
}
