import { Button, type ButtonProps } from '@/lib/ui';

type Props = Omit< ButtonProps, 'variant' | 'size' | 'layout' >;

/**
 * An unstyled Button for sidebar list rows, which supply their own dimensions,
 * colors, and active state.
 */
export function SidebarButton( { render, nativeButton, ...props }: Props ) {
	return (
		<Button
			variant="unstyled"
			layout="inline"
			render={ render }
			// A `render` prop replaces the native <button>; opt out of Base UI's
			// native-button semantics unless the caller explicitly opts back in.
			nativeButton={ nativeButton ?? ! render }
			{ ...props }
		/>
	);
}
