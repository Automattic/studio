import { color as colorIcon } from '@wordpress/icons';
import { Button, Menu } from '@/ui-desks/components';
import styles from './style.module.css';
import type { AnyColorControlConfig, ControlRendererProps } from './types';
import type { CSSProperties } from 'react';

type ColorControlProps = ControlRendererProps & {
	control: AnyColorControlConfig;
};

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
					<Button
						icon={ colorIcon }
						label={ control.label }
						variant="quiet"
						size="medium"
						aria-pressed={ isOpen }
					/>
				}
			/>
			<Menu.Popup
				side="top"
				align="center"
				sideOffset={ 18 }
				layout="row"
				width="content"
				className={ styles.swatchMenu }
			>
				{ control.options.map( ( option ) => (
					<Menu.Item
						key={ option.value }
						variant="custom"
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
