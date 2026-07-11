import { useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import FeedbackModal from 'src/modules/feedback/components/feedback-modal';

// App-context entry point for the feedback modal, opened via the `feedback-modal`
// IPC event (e.g. the Help menu). This lives inside the provider tree, so it can
// read auth state — unlike the crash-screen entry point, which renders the modal
// directly with no identity.
export default function FeedbackModalContainer() {
	const [ isOpen, setIsOpen ] = useState( false );
	const { isAuthenticated, user } = useAuth();

	useIpcListener( 'feedback-modal', () => {
		setIsOpen( true );
	} );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<FeedbackModal
			identity={ {
				isAuthenticated,
				email: user?.email,
				displayName: user?.displayName,
			} }
			source="menu"
			onClose={ () => setIsOpen( false ) }
		/>
	);
}
