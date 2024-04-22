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
	variant?: 'primary' | 'secondary' | 'tertiary' | 'link' | 'icon';
	truncate?: boolean;
};

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
			variant={ variant === 'icon' ? undefined : variant }
			className={ cx(
				baseStyles,
				variant === 'primary' && primaryStyles,
				variant === 'secondary' && secondaryStyles,
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
