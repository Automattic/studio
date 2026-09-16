import { Button } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from '@/components/selective-sync/lib/cx';

type ButtonProps = ComponentProps< typeof Button > & {
	variant?: 'primary' | 'link';
};

/**
 * The arbitrary Tailwind variants below (e.g., `[&.is-primary]`) are used to
 * achieve the specificity required to override the default button styles
 * without `!important`, which often creates specificity collisions.
 */
const baseStyles = `
px-3
py-2
rounded-sm
justify-center
disabled:cursor-not-allowed
aria-disabled:cursor-not-allowed
[&.components-button]:focus:shadow-[inset_0_0_0_1px_transparent]
[&.components-button]:focus-visible:shadow-[0_0_0_1px_var(--color-frame-theme)]
[&.components-button]:focus-visible:shadow-frame-theme
[&.components-button.is-destructive]:focus-visible:shadow-a8c-red-50
[&_svg]:shrink-0
`.replace( /\n/g, ' ' );

const primaryStyles = `
[&.is-primary:not(:disabled)]:focus:shadow-[inset_0_0_0_1px_transparent]
[&.is-primary:not(:disabled)]:focus-visible:shadow-[inset_0_0_0_1px_white,0_0_0_1px_var(--color-frame-theme)]
`.replace( /\n/g, ' ' );

const linkStyles = `
[&.is-link]:no-underline
[&.is-link]:hover:text-frame-theme
[&.is-link]:active:text-frame-text
[&.is-link]:disabled:text-a8c-gray-50
`.replace( /\n/g, ' ' );

export default function ButtonComponent( { className, variant, ...props }: ButtonProps ) {
	return (
		<Button
			{ ...props }
			variant={ variant }
			className={ cx(
				baseStyles,
				variant === 'primary' && primaryStyles,
				variant === 'link' && linkStyles,
				className
			) }
		/>
	);
}
