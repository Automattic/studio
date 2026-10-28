import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
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
	disabled,
}: {
	text: string;
	label: string;
	className?: string;
	size?: 'icon-2xs' | 'icon-xs' | 'icon-sm';
	disabled?: boolean;
} ) {
	const { copied, copy } = useCopyText( text );
	const [ hovered, setHovered ] = useState( false );
	const Icon = copied ? CheckIcon : DuplicateIcon;
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
