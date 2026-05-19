import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';

interface ChatButtonProps {
	onClick: () => void;
}

export function ChatButton( { onClick }: ChatButtonProps ) {
	return (
		<Button
			icon={ comment }
			intent="chat"
			label={ __( 'Chat about selection' ) }
			size="medium"
			tone="primary"
			variant="filled"
			onClick={ onClick }
		/>
	);
}
