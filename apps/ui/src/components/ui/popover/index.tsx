import { Popover as BasePopover } from '@base-ui/react/popover';
import { FloatingSurface } from '@/components/ui/surface';
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
	alignOffset,
	anchor,
	backdrop = false,
	className,
	style,
	initialFocus,
	finalFocus,
}: {
	children: ReactNode;
	side?: PositionerProps[ 'side' ];
	align?: PositionerProps[ 'align' ];
	sideOffset?: number;
	alignOffset?: number;
	anchor?: PositionerProps[ 'anchor' ];
	// Catches outside clicks that would otherwise land in a webview and never dismiss it.
	backdrop?: boolean;
	className?: string;
	style?: CSSProperties;
	initialFocus?: PopupProps[ 'initialFocus' ];
	finalFocus?: PopupProps[ 'finalFocus' ];
} ) {
	return (
		<BasePopover.Portal>
			{ backdrop ? <BasePopover.Backdrop className={ styles.backdrop } /> : null }
			<BasePopover.Positioner
				side={ side }
				align={ align }
				sideOffset={ sideOffset }
				alignOffset={ alignOffset }
				anchor={ anchor }
				className={ styles.positioner }
			>
				<BasePopover.Popup
					data-slot="popover-content"
					initialFocus={ initialFocus }
					finalFocus={ finalFocus }
					render={ <FloatingSurface className={ className } style={ style } /> }
				>
					{ children }
				</BasePopover.Popup>
			</BasePopover.Positioner>
		</BasePopover.Portal>
	);
}
