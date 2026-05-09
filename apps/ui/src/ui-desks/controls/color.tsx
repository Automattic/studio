import { color as colorIcon } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
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
		<div className={ styles.control }>
			<button
				type="button"
				className={ styles.button }
				data-active={ isOpen ? 'true' : 'false' }
				title={ control.label }
				aria-label={ control.label }
				onClick={ () => setIsOpen( ! isOpen ) }
			>
				<Icon icon={ colorIcon } size={ 24 } />
			</button>
			{ isOpen && (
				<div className={ styles.popover }>
					{ control.options.map( ( option ) => (
						<button
							key={ option.value }
							type="button"
							className={ styles.swatch }
							style={ getSwatchStyle( option.color ) }
							data-active={ currentValue === option.value ? 'true' : 'false' }
							title={ option.label }
							aria-label={ option.label }
							onClick={ () => {
								updateProps( { [ control.property ]: option.value } );
								setIsOpen( false );
							} }
						/>
					) ) }
				</div>
			) }
		</div>
	);
}

function getSwatchStyle( color: string ): CSSProperties {
	return {
		'--control-swatch-color': color,
	} as CSSProperties;
}
