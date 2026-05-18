import { sprintf, __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import {
	createWorkspaceDollyWorkspaceDescriptor,
	useSelectedWorkspaceDollyConversationId,
	useWorkspaceDollyConversationsForWorkspace,
} from 'src/modules/workspaces/lib/dolly/session';
import type { ReactNode } from 'react';
import type { WorkspaceDollyConversationState } from 'src/modules/workspaces/lib/dolly/types';
import type { StudioWorkspace } from 'src/modules/workspaces/types';

type WorkspaceSidebarRowProps = {
	workspace: StudioWorkspace;
	isSelected: boolean;
	localRunControl?: ReactNode;
	onSelect: () => void;
	onSelectChat: ( conversationId: string ) => void;
};

function isBlankConversation( conversation: WorkspaceDollyConversationState ) {
	return conversation.messages.length === 0 && ! conversation.input.trim();
}

function getConversationUpdatedLabel( conversation: WorkspaceDollyConversationState ) {
	return new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
	} ).format( new Date( conversation.lastUpdated ) );
}

function getConversationLabel( conversation: WorkspaceDollyConversationState ) {
	const firstUserMessage = conversation.messages.find( ( message ) => message.role === 'user' );
	const fallbackDate = getConversationUpdatedLabel( conversation );

	if ( firstUserMessage?.content.trim() ) {
		return firstUserMessage.content.trim().replace( /\s+/g, ' ' ).slice( 0, 48 );
	}

	return sprintf( __( 'Chat from %s' ), fallbackDate );
}

export function WorkspaceSidebarRow( {
	workspace,
	isSelected,
	localRunControl,
	onSelect,
	onSelectChat,
}: WorkspaceSidebarRowProps ) {
	const workspaceDescriptor = useMemo(
		() => createWorkspaceDollyWorkspaceDescriptor( workspace ),
		[ workspace ]
	);
	const selectedConversationId = useSelectedWorkspaceDollyConversationId( workspaceDescriptor );
	const recentConversations = useWorkspaceDollyConversationsForWorkspace( workspaceDescriptor )
		.filter( ( conversation ) => ! isBlankConversation( conversation ) )
		.slice( 0, 3 );

	return (
		<li className={ cx( 'min-w-[168px] transition-all ms-1', isMac() ? 'me-5' : 'me-4' ) }>
			<div
				className={ cx(
					'flex h-8 flex-row items-center rounded transition-all hover:bg-[#ffffff0C]',
					isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
				) }
			>
				<button
					type="button"
					className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
					onClick={ onSelect }
				>
					{ workspace.name }
				</button>
				{ localRunControl }
			</div>
			{ recentConversations.length > 0 && (
				<ol className="mb-1 ms-3 mt-0.5 space-y-0.5">
					{ recentConversations.map( ( conversation ) => {
						const label = getConversationLabel( conversation );
						const isChatSelected = isSelected && conversation.id === selectedConversationId;
						return (
							<li key={ conversation.id }>
								<button
									type="button"
									aria-label={ sprintf(
										// translators: %s is a Dolly chat label.
										__( 'Open chat: %s' ),
										label
									) }
									className={ cx(
										'block h-6 w-full truncate rounded px-2 text-left text-[11px] leading-6 text-white/60 transition hover:bg-[#ffffff0C] hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
										isChatSelected && 'bg-[#ffffff14] text-white'
									) }
									onClick={ () => onSelectChat( conversation.id ) }
								>
									{ label }
								</button>
							</li>
						);
					} ) }
				</ol>
			) }
		</li>
	);
}
