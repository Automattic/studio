import { useState } from 'react';
import { UserDeskChats } from './chats';
import { DeskChrome } from './chrome';
import { UserDesk } from './user-desk';

export function DesksUiApp() {
	const [ chatsOpen, setChatsOpen ] = useState( false );

	return (
		<>
			<DeskChrome
				chatsOpen={ chatsOpen }
				onToggleChats={ () => setChatsOpen( ( open ) => ! open ) }
			/>
			<UserDeskChats open={ chatsOpen } />
			<UserDesk />
		</>
	);
}
