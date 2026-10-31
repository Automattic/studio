import { Popover as BasePopover } from '@base-ui/react/popover';
import { clsx } from 'clsx';
import { FloatingSurface } from '@/lib/ui/surface';
import styles from './style.module.css';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

export const Root = BasePopover.Root;
export const Trigger = BasePopover.Trigger;
export function Title( { className, ...props }: ComponentProps< typeof BasePopover.Title > ) {
	return <BasePopover.Title { ...props } className={ clsx( styles.title, className ) } />;
}

export function Description( {
	className,
	...props
}: ComponentProps< typeof BasePopover.Description > ) {
	return (
		<BasePopover.Description { ...props } className={ clsx( styles.description, className ) } />
	);
}

type PositionerProps = ComponentProps< typeof BasePopover.Positioner >;
type PopupProps = ComponentProps< typeof BasePopover.Popup >;

// A command sheet sits on the composer's surface, spans its anchor and stays above it.
const COMMANDS_COLLISION_AVOIDANCE = {
	side: 'none',
	align: 'shift',
	fallbackAxisSide: 'none',
} as const;

/** Portal + Positioner + Popup on the floating surface, its content themed to match. */
export function Popup( {
	children,
	side = 'bottom',
	align = 'start',
	sideOffset = 4,
	alignOffset,
	anchor,
	backdrop = false,
	keepMounted = false,
	className,
	style,
	initialFocus,
	finalFocus,
	variant = 'floating',
	'aria-label': ariaLabel,
	'aria-describedby': ariaDescribedBy,
}: {
	children: ReactNode;
	side?: PositionerProps[ 'side' ];
	align?: PositionerProps[ 'align' ];
	sideOffset?: number;
	alignOffset?: number;
	anchor?: PositionerProps[ 'anchor' ];
	// Catches outside clicks that would otherwise land in a webview and never dismiss it.
	backdrop?: boolean;
	keepMounted?: boolean;
	className?: string;
	style?: CSSProperties;
	initialFocus?: PopupProps[ 'initialFocus' ];
	finalFocus?: PopupProps[ 'finalFocus' ];
	variant?: 'floating' | 'commands';
	'aria-label'?: string;
	'aria-describedby'?: string;
} ) {
	const commands = variant === 'commands';
	return (
		<BasePopover.Portal keepMounted={ keepMounted }>
			{ backdrop ? <BasePopover.Backdrop className={ styles.backdrop } /> : null }
			{ /* Fixed, so a popup sliding in from off-screen can't scroll the page sideways. */ }
			<BasePopover.Positioner
				positionMethod="fixed"
				side={ side }
				align={ align }
				sideOffset={ sideOffset }
				alignOffset={ alignOffset }
				anchor={ anchor }
				collisionAvoidance={ commands ? COMMANDS_COLLISION_AVOIDANCE : undefined }
				collisionPadding={ commands ? 5 : undefined }
				className={ styles.positioner }
			>
				<BasePopover.Popup
					data-slot="popover-content"
					initialFocus={ initialFocus }
					finalFocus={ finalFocus }
					aria-label={ ariaLabel }
					aria-describedby={ ariaDescribedBy }
					render={
						commands ? (
							<div className={ clsx( styles.commands, className ) } style={ style } />
						) : (
							<FloatingSurface className={ className } style={ style } />
						)
					}
				>
					{ children }
				</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
