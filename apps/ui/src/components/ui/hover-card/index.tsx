import { PreviewCard } from '@base-ui/react/preview-card';
import { clsx } from 'clsx';
import surface from '@/components/ui/surface/style.module.css';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export const Root = PreviewCard.Root;
export const Trigger = PreviewCard.Trigger;

type PositionerProps = ComponentProps< typeof PreviewCard.Positioner >;

/** A card that opens over its trigger on hover, styled by the caller. */
export function Popup( {
	children,
	side = 'bottom',
	align = 'center',
	sideOffset = 4,
	className,
}: {
	children: ReactNode;
	side?: PositionerProps[ 'side' ];
	align?: PositionerProps[ 'align' ];
	sideOffset?: number;
	className?: string;
} ) {
	return (
		<PreviewCard.Portal>
			<PreviewCard.Positioner
				side={ side }
				align={ align }
				sideOffset={ sideOffset }
				collisionPadding={ 8 }
				className={ styles.positioner }
			>
				<PreviewCard.Popup className={ clsx( surface.motion, className ) }>
					{ children }
				</PreviewCard.Popup>
			</PreviewCard.Positioner>
		</PreviewCard.Portal>
	);
}
