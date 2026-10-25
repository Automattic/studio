import { Button as BaseButton } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { Kbd } from '@/lib/ui/kbd';
import { Spinner } from '@/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui/tooltip';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export type ButtonVariant =
	| 'default'
	| 'accent'
	| 'outline'
	| 'segmented'
	| 'secondary'
	| 'muted'
	| 'ghost'
	| 'muted-ghost'
	| 'destructive'
	| 'link'
	| 'inline-link'
	| 'inline-text'
	| 'inline-accent'
	| 'overlay'
	| 'unstyled';

export type ButtonSize =
	| 'default'
	| 'header'
	| 'composer-notice'
	| '2xs'
	| 'xs'
	| 'sm'
	| 'lg'
	| 'inline'
	| 'icon'
	| 'icon-inline'
	| 'icon-2xs'
	| 'icon-xs'
	| 'icon-sm';

export type ButtonProps = ComponentProps< typeof BaseButton > & {
	variant?: ButtonVariant;
	size?: ButtonSize;
	shape?: 'default' | 'round';
	layout?: 'default' | 'row' | 'inline';
	/** How fast the expanded or pressed state fades in: `layout` for a trigger whose popup slides in. */
	activeMotion?: 'surface' | 'layout';
	disabledAppearance?: 'default' | 'icon' | 'outline';
	/** Disables the button and leads its label with a spinner. */
	loading?: boolean;
	/** The spinner's accessible label while `loading`. */
	loadingAnnouncement?: string;
};

export function Button( {
	variant = 'default',
	size = 'default',
	shape = 'default',
	layout = 'default',
	activeMotion = 'surface',
	disabledAppearance = 'default',
	loading = false,
	loadingAnnouncement,
	disabled,
	focusableWhenDisabled,
	className,
	children,
	...props
}: ButtonProps ) {
	return (
		<BaseButton
			data-slot="button"
			data-variant={ variant }
			data-size={ size }
			data-shape={ shape === 'default' ? undefined : shape }
			data-layout={ layout === 'default' ? undefined : layout }
			data-active-motion={ activeMotion === 'surface' ? undefined : activeMotion }
			data-disabled-appearance={ disabledAppearance === 'default' ? undefined : disabledAppearance }
			aria-busy={ loading || undefined }
			disabled={ disabled || loading }
			focusableWhenDisabled={ loading || focusableWhenDisabled }
			className={ clsx( styles.button, className ) }
			{ ...props }
		>
			{ loading && (
				<Spinner
					data-icon="inline-start"
					aria-hidden={ ! loadingAnnouncement || undefined }
					aria-label={ loadingAnnouncement }
				/>
			) }
			{ children }
		</BaseButton>
	);
}

type Shortcut = { displayShortcut: string; ariaKeyShortcut: string };

type IconButtonProps = Omit< ButtonProps, 'children' > & {
	icon: ReactNode;
	/** The accessible name, also shown in the tooltip. */
	label: string;
	shortcut?: Shortcut;
	tooltip?: boolean;
	tooltipSide?: ComponentProps< typeof TooltipContent >[ 'side' ];
	children?: ReactNode;
};

/** An icon-only Button, named by a tooltip. */
export function IconButton( {
	icon,
	label,
	shortcut,
	tooltip = true,
	tooltipSide = 'top',
	variant = 'ghost',
	size = 'icon',
	children,
	...props
}: IconButtonProps ) {
	const button = (
		<Button
			variant={ variant }
			size={ size }
			aria-label={ label }
			aria-keyshortcuts={ shortcut?.ariaKeyShortcut }
			focusableWhenDisabled
			{ ...props }
		>
			{ icon }
			{ children }
		</Button>
	);
	if ( ! tooltip ) {
		return button;
	}
	return (
		<Tooltip>
			<TooltipTrigger render={ button } />
			<TooltipContent side={ tooltipSide }>
				{ label }
				{ shortcut && <Kbd>{ shortcut.displayShortcut }</Kbd> }
			</TooltipContent>
		</Tooltip>
	);
}
