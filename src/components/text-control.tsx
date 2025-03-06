import { TextControl } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from 'src/lib/cx';

type TextControlProps = ComponentProps< typeof TextControl >;

const TextControlComponent = ( props: TextControlProps ) => {
	return (
		<TextControl
			{ ...props }
			__next40pxDefaultSize={ true }
			__nextHasNoMarginBottom={ true }
			className={ cx(
				'[&_input]:!px-4 [&_input]:!py-3 [&_input]:!rounded-sm [&_input]:!self-stretch [&_input]:!align-center [&_input]:!gap-1 [&_input]:!flex',
				props.disabled &&
					'[&_input]:!bg-a8c-gray-100 [&_input]:!text-a8c-gray-600 [&_input]:!border-a8c-gray-400',
				props.className
			) }
		/>
	);
};

export default TextControlComponent;
