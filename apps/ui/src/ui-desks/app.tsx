import { useState } from 'react';
import { UserDeskChats } from './chats';
import { DeskChrome } from './chrome';
import { UserDesk } from './user-desk';

export function DesksUiApp() {
	const [ chatsOpen, setChatsOpen ] = useState( false );

	return (
		<div data-ui-mode="desks">
			<DeskChrome
				chatsOpen={ chatsOpen }
				onToggleChats={ () => setChatsOpen( ( open ) => ! open ) }
			/>
			<UserDeskChats open={ chatsOpen } />
			<UserDesk />
		</div>
	);
}
