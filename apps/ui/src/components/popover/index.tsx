import { Popover as BasePopover } from '@base-ui/react/popover';
import { ThemeProvider } from '@wordpress/theme';
import { FLOATING_SURFACE_BACKGROUND, FloatingSurface } from '@/components/floating-surface';
import styles from './style.module.css';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

export const Root = BasePopover.Root;
export const Trigger = BasePopover.Trigger;
export const Close = BasePopover.Close;
export const Title = BasePopover.Title;

type PositionerProps = ComponentProps< typeof BasePopover.Positioner >;
type PopupProps = ComponentProps< typeof BasePopover.Popup >;

/** Portal + Positioner + Popup on the floating surface, its content themed to match. */
export function Popup( {
	children,
	side = 'bottom',
	align = 'start',
	sideOffset = 4,
	anchor,
	className,
	style,
	initialFocus,
	finalFocus,
}: {
	children: ReactNode;
	side?: PositionerProps[ 'side' ];
	align?: PositionerProps[ 'align' ];
	sideOffset?: number;
	anchor?: PositionerProps[ 'anchor' ];
	className?: string;
	style?: CSSProperties;
	initialFocus?: PopupProps[ 'initialFocus' ];
	finalFocus?: PopupProps[ 'finalFocus' ];
} ) {
	return (
		<BasePopover.Portal>
			<BasePopover.Positioner
				side={ side }
				align={ align }
				sideOffset={ sideOffset }
				anchor={ anchor }
				className={ styles.positioner }
			>
				<BasePopover.Popup
					initialFocus={ initialFocus }
					finalFocus={ finalFocus }
					render={ <FloatingSurface className={ className } style={ style } /> }
				>
					<ThemeProvider color={ { background: FLOATING_SURFACE_BACKGROUND } }>
						{ children }
					</ThemeProvider>
				</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
