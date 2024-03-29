import { Button } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from '../lib/cx';

export type ButtonProps = ComponentProps< typeof Button >;

/**
 * The arbitrary Tailwind variants below (e.g., `[&.is-secondary]`) are used to
 * achieve the specificity required to override the default button styles
 * without `!important`, which often creates specificity collisions.
 *
 * The `inset_0_0_0_1px_black` shadow is used to replicate the border shadow
 * Gutenberg uses for buttons. The color is arbitrary and overridden by
 * additional styles.
 */
const secondaryStyles = `
[&.is-secondary]:text-black
[&.is-secondary]:shadow-[inset_0_0_0_1px_black]
[&.is-secondary]:shadow-a8c-gray-5
[&.is-secondary:not(.is-destructive):not(:disabled)]:hover:text-a8c-blueberry
[&.is-secondary:disabled:not(:focus)]:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:disabled:not(:focus)]:shadow-a8c-gray-5
[&.is-secondary:not(:focus)]:aria-disabled:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:not(:focus)]:aria-disabled:shadow-a8c-gray-5
[&.is-secondary:not(:focus)]:aria-disabled:hover:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:not(:focus)]:aria-disabled:hover:shadow-a8c-gray-5
`.replace( /\n/g, ' ' );

const destructiveStyles = `
[&.is-destructive:not(.is-primary)]:text-a8c-red-50
[&.is-destructive:not(.is-primary)]:hover:text-a8c-red-70
[&.is-destructive.is-primary]:text-white
[&.is-destructive.is-primary]:bg-a8c-red-50
[&.is-destructive.is-primary:not(:disabled)]:hover:bg-a8c-red-60
`.replace( /\n/g, ' ' );

const linkStyles = `
[&.is-link]:no-underline
[&.is-link]:disabled:text-a8c-gray-50
`.replace( /\n/g, ' ' );

export default function ButtonComponent( { className, variant, ...props }: ButtonProps ) {
	return (
		<Button
			{ ...props }
			variant={ variant }
			className={ cx(
				'cursor-default px-3 py-2 !rounded-sm justify-center disabled:cursor-not-allowed',
				variant === 'secondary' && secondaryStyles,
				variant === 'link' && linkStyles,
				props.isDestructive && destructiveStyles,
				className
			) }
		/>
	);
}
