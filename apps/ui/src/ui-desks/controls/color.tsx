import { color as colorIcon } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import styles from './style.module.css';
import type { ControlConfig, ControlRendererProps } from './types';
import type { CSSProperties } from 'react';

type ColorControlConfig = Extract< ControlConfig, { type: 'color' } >;

type ColorControlProps = ControlRendererProps< ColorControlConfig >;

export function ColorControl( {
	control,
	isOpen,
	setIsOpen,
	updateProps,
	props,
}: ColorControlProps ) {
	const currentValue = props[ control.property ];

	return (
		<Menu.Root modal={ false } open={ isOpen } orientation="horizontal" onOpenChange={ setIsOpen }>
			<Menu.Trigger
				render={
					<IconButton
						icon={ colorIcon }
						label={ control.label }
						size="compact"
						tone="neutral"
						variant="minimal"
						aria-pressed={ isOpen }
						className={ styles.button }
					/>
				}
			/>
			<Menu.Popup side="top" align="center" sideOffset={ 18 } className={ styles.swatchMenu }>
				{ control.options.map( ( option ) => (
					<Menu.Item
						key={ option.value }
						className={ styles.swatch }
						style={ getSwatchStyle( option.color ) }
						data-active={ currentValue === option.value ? 'true' : 'false' }
						title={ option.label }
						aria-label={ option.label }
						label={ option.label }
						onClick={ () => {
							updateProps( { [ control.property ]: option.value } );
						} }
					/>
				) ) }
			</Menu.Popup>
		</Menu.Root>
	);
}

function getSwatchStyle( color: string ): CSSProperties {
	return {
		'--control-swatch-color': color,
	} as CSSProperties;
}
