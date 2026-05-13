import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';

interface DeskSettingsButtonProps {
	open: boolean;
	onToggle: () => void;
}

export function DeskSettingsButton( { open, onToggle }: DeskSettingsButtonProps ) {
	return (
		<Button
			icon={ cog }
			label={ open ? __( 'Close desk settings' ) : __( 'Open desk settings' ) }
			aria-pressed={ open }
			onClick={ onToggle }
		/>
	);
}
