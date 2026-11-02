import { __, sprintf } from '@wordpress/i18n';
import { XIcon } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';
import type { ComponentType } from 'react';

// A mode the composer is in; hovering offers to remove it.
export function ModeChip( {
	icon: ModeIcon,
	label,
	onRemove,
	disabled,
}: {
	icon: ComponentType< { className?: string } >;
	label: string;
	onRemove: () => void;
	disabled?: boolean;
} ) {
	const removeLabel = sprintf(
		/* translators: %s: name of a composer mode, e.g. "Auto-start". */
		__( 'Remove %s' ),
		label
	);
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="muted"
						size="sm"
						shape="round"
						className={ styles.modeChip }
						aria-label={ removeLabel }
						disabled={ disabled }
						onClick={ onRemove }
					/>
				}
			>
				<span className={ styles.modeChipIcon } data-icon="inline-start">
					<ModeIcon />
					<XIcon />
				</span>
				{ label }
			</TooltipTrigger>
			<TooltipContent>{ removeLabel }</TooltipContent>
		</Tooltip>
	);
}
