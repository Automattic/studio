import { TextControl } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from '../lib/cx';

type TextControlProps = ComponentProps< typeof TextControl >;

const TextControlComponent = ( props: TextControlProps ) => {
	return (
		<TextControl
			{ ...props }
			__next40pxDefaultSize={ true }
			__nextHasNoMarginBottom={ true }
			className={ cx(
				'[&_input]:!px-4 [&_input]:!py-3 [&_input]:!rounded-sm [&_input]:!self-stretch [&_input]:!align-center [&_input]:!gap-1 [&_input]:!flex',
				props.className
			) }
		/>
	);
};

export default TextControlComponent;
