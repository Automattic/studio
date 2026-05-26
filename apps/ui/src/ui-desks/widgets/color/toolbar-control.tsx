import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { contrastingShade, formatColor } from '@/ui-desks/widgets/color/component';
import styles from './toolbar-control.module.css';
import { isColorWidgetProps, type ColorFormat, type ColorWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';
import type { CSSProperties } from 'react';

export function ColorToolbarControl( { props }: ControlRenderContext< ColorWidgetProps > ) {
	const [ copied, setCopied ] = useState( false );

	if ( ! isColorWidgetProps( props ) ) {
		return null;
	}

	const format = getColorFormat( props.format );
	const value = formatColor( props.color, format );

	function copyColor() {
		void navigator.clipboard.writeText( value ).then( () => {
			setCopied( true );
			window.setTimeout( () => setCopied( false ), 1200 );
		} );
	}

	return (
		<button
			type="button"
			className={ styles.button }
			onClick={ copyColor }
			style={
				{
					background: props.color,
					color: contrastingShade( props.color ),
				} as CSSProperties
			}
		>
			{ copied ? __( 'Copied' ) : value }
		</button>
	);
}

function getColorFormat( format: ColorFormat | undefined ): ColorFormat {
	return format === 'rgb' || format === 'hsl' ? format : 'hex';
}
