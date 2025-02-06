import { ComponentProps } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';

type ButtonProps = ComponentProps< typeof Button >;

export default function LinkButtonComponent( { className, ...props }: ButtonProps ) {
	return (
		<Button
			{ ...props }
			variant="link"
			className={ cx(
				'px-3 py-2 text-sm font-semibold disabled:opacity-30 !text-gray-600',
				className
			) }
		/>
	);
}
