import { __ } from '@wordpress/i18n';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { useCopyText } from '@/data/host/use-copy-text';
import { DuplicateIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger, VisuallyHidden } from '@/lib/ui';

/** An icon button that copies `text`; its tooltip stays open on "Copied" after a copy. */
export function CopyButton( {
	text,
	label,
	className,
	size = 'icon-xs',
	icon = 'duplicate',
	disabled,
}: {
	text: string;
	label: string;
	className?: string;
	size?: 'icon-xs' | 'icon-sm';
	// Credentials show a copy icon; everything else duplicates.
	icon?: 'duplicate' | 'copy';
	disabled?: boolean;
} ) {
	const { copied, copy } = useCopyText( text );
	const [ hovered, setHovered ] = useState( false );
	const Icon = copied ? CheckIcon : icon === 'copy' ? CopyIcon : DuplicateIcon;
	return (
		<>
			<Tooltip open={ copied || hovered } onOpenChange={ setHovered }>
				<TooltipTrigger
					render={
						<Button
							variant="muted-ghost"
							size={ size }
							className={ className }
							aria-label={ label }
							disabled={ disabled }
							onClick={ copy }
						/>
					}
				>
					<Icon />
				</TooltipTrigger>
				<TooltipContent>{ copied ? __( 'Copied' ) : label }</TooltipContent>
			</Tooltip>
			<VisuallyHidden role="status" aria-live="polite">
				{ copied ? __( 'Copied' ) : '' }
			</VisuallyHidden>
		</>
	);
}
