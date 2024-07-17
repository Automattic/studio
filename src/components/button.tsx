import { Button } from '@wordpress/components';
import { useResizeObserver } from '@wordpress/compose';
import { ComponentProps, useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';

/**
 * Sourced from https://stackoverflow.com/a/76616671/378228 to address
 * unexpectedly missing `Button` properties when using `Omit` to overwrite the
 * existing `variant` property.
 */
type MappedOmit< T, K extends PropertyKey > = { [ P in keyof T as Exclude< P, K > ]: T[ P ] };

export type ButtonProps = MappedOmit< ComponentProps< typeof Button >, 'variant' > & {
	variant?: ButtonVariant;
	truncate?: boolean;
};

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'outlined' | 'link' | 'icon';

/**
 * The arbitrary Tailwind variants below (e.g., `[&.is-secondary]`) are used to
 * achieve the specificity required to override the default button styles
 * without `!important`, which often creates specificity collisions.
 *
 * The `inset_0_0_0_1px_black` shadow is used to replicate the border shadow
 * Gutenberg uses for buttons. The color is arbitrary and overridden by
 * additional styles.
 */
const baseStyles = `
px-3
py-2
rounded-sm
justify-center
disabled:cursor-not-allowed
aria-disabled:cursor-not-allowed
[&.components-button]:focus:shadow-[inset_0_0_0_1px_transparent]
[&.components-button]:focus-visible:shadow-[0_0_0_1px_#3858E9]
[&.components-button]:focus-visible:shadow-a8c-blueberry
[&.components-button.is-destructive]:focus-visible:shadow-a8c-red-50
[&_svg]:shrink-0
`.replace( /\n/g, ' ' );

const primaryStyles = `
[&.is-primary:not(:disabled)]:focus:shadow-[inset_0_0_0_1px_transparent]
[&.is-primary:not(:disabled)]:focus-visible:shadow-[inset_0_0_0_1px_white,0_0_0_1px_#3858E9]
`.replace( /\n/g, ' ' );

const secondaryStyles = `
[&.is-secondary]:text-black
[&.is-secondary]:shadow-[inset_0_0_0_1px_black]
[&.is-secondary]:shadow-a8c-gray-5
[&.is-secondary]:focus:shadow-a8c-gray-5
[&.is-secondary]:focus-visible:shadow-a8c-blueberry
[&.is-secondary:not(.is-destructive,:disabled,[aria-disabled=true])]:hover:text-a8c-blueberry
[&.is-secondary:not(.is-destructive,:disabled,[aria-disabled=true])]:active:text-black
[&.is-secondary:disabled:not(:focus)]:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:disabled:not(:focus)]:shadow-a8c-gray-5
[&.is-secondary:not(:focus)]:aria-disabled:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:not(:focus)]:aria-disabled:shadow-a8c-gray-5
[&.is-secondary:not(:focus)]:aria-disabled:hover:shadow-[inset_0_0_0_1px_black]
[&.is-secondary:not(:focus)]:aria-disabled:hover:shadow-a8c-gray-5
`.replace( /\n/g, ' ' );

const outlinedStyles = `
outlined
text-white
[&.components-button]:hover:text-black
[&.components-button]:hover:bg-gray-100
[&.components-button]:active:text-black
[&.components-button]:active:bg-gray-100
[&.components-button]:shadow-[inset_0_0_0_1px_white]
[&.components-button.outlined]:focus:shadow-[inset_0_0_0_1px_white]
[&.components-button]:focus-visible:outline-none
[&.components-button.outlined]:focus-visible:shadow-[inset_0_0_0_1px_#3858E9]
[&.components-button]:focus-visible:shadow-a8c-blueberry
`.replace( /\n/g, ' ' );

const destructiveStyles = `
[&.is-destructive:not(.is-primary)]:text-a8c-red-50
[&.is-destructive:not(.is-primary)]:hover:text-a8c-red-70
[&.is-destructive.is-primary]:text-white
[&.is-destructive.is-primary]:bg-a8c-red-50
[&.is-destructive.is-primary:not(:disabled)]:hover:bg-a8c-red-60
[&.is-destructive.is-primary:not(:disabled)]:focus-visible:shadow-[inset_0_0_0_1px_white,0_0_0_1px_#d63638]
`.replace( /\n/g, ' ' );

const linkStyles = `
[&.is-link]:no-underline
[&.is-link]:hover:text-[#2145e6]
[&.is-link]:active:text-black
[&.is-link]:disabled:text-a8c-gray-50
`.replace( /\n/g, ' ' );

const iconStyles = `
[&.components-button]:p-0
h-auto
hover:bg-white
hover:bg-opacity-10
`.replace( /\n/g, ' ' );

/**
 * Filter out custom values from the `variant` prop to avoid passing invalid
 * values to the core WordPress components.
 *
 * @param variant - The button variant.
 * @returns The variant value or, if the value is a Studio-specific, `undefined`.
 */
function sansCustomValues( variant: ButtonVariant | undefined ) {
	return !! variant && [ 'outlined', 'icon' ].includes( variant )
		? undefined
		: ( variant as Exclude< ButtonVariant, 'outlined' | 'icon' > | undefined );
}

export default function ButtonComponent( {
	className,
	variant,
	truncate,
	children,
	showTooltip,
	...props
}: ButtonProps ) {
	const [ isTruncated, setIsTruncated ] = useState( false );
	const element = useRef< HTMLSpanElement >( null );
	const [ resizeListener, sizes ] = useResizeObserver();
	useEffect( () => {
		if ( ! element.current || ! truncate ) {
			return;
		}
		setIsTruncated( element.current.offsetWidth < element.current.scrollWidth );
	}, [ sizes, truncate ] );
	return (
		<Button
			{ ...props }
			variant={ sansCustomValues( variant ) }
			className={ cx(
				baseStyles,
				variant === 'primary' && primaryStyles,
				variant === 'secondary' && secondaryStyles,
				variant === 'outlined' && outlinedStyles,
				variant === 'link' && linkStyles,
				variant === 'icon' && iconStyles,
				props.isDestructive && destructiveStyles,
				className
			) }
			showTooltip={ showTooltip || ( truncate && isTruncated ) }
		>
			{ truncate
				? [
						<span ref={ element } className="truncate relative" key="content">
							{ resizeListener }
							{ children }
						</span>,
				  ]
				: children }
		</Button>
	);
}
