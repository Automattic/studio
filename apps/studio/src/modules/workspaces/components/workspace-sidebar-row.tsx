import { Spinner } from '@wordpress/components';
import { sprintf, __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { Tooltip } from 'src/components/tooltip';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import {
	createWorkspaceDollyWorkspaceDescriptor,
	useSelectedWorkspaceDollyConversationId,
	useWorkspaceDollyConversationsForWorkspace,
} from 'src/modules/workspaces/lib/dolly/session';
import { useWorkspaceDollyWorkspaceActivity } from 'src/modules/workspaces/lib/dolly/turns';
import { useRootSelector } from 'src/stores';
import { stagingSyncSelectors, syncOperationsSelectors } from 'src/stores/sync';
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
	const workspaceActivity = useWorkspaceDollyWorkspaceActivity( workspace.id );
	const localSiteId = workspace.targets.local?.siteId ?? '';
	const productionSiteId = workspace.targets.production?.siteId;
	const stagingSiteId = workspace.targets.staging?.siteId;
	const isLocalPulling = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPulling( localSiteId )
	);
	const isLocalPushing = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPushing( localSiteId )
	);
	const isProductionStagingSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSiteId )
	);
	const isStagingEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsRemoteSiteEnvironmentSyncing( stagingSiteId )
	);
	const isAssistantThinking = Boolean( workspaceActivity.isAssistantThinking );
	const isSyncing =
		isLocalPulling || isLocalPushing || isProductionStagingSyncing || isStagingEnvironmentSyncing;
	const showActivitySpinner = isAssistantThinking || isSyncing;
	const activityTooltip = isAssistantThinking
		? isSyncing
			? __( 'Assistant and sync in progress' )
			: __( 'Assistant thinking' )
		: __( 'Syncing' );
	const activityLabel = isAssistantThinking
		? isSyncing
			? sprintf(
					// translators: %s is a workspace name.
					__( '%s assistant and sync are active' ),
					workspace.name
			  )
			: sprintf(
					// translators: %s is a workspace name.
					__( '%s assistant is thinking' ),
					workspace.name
			  )
		: sprintf(
				// translators: %s is a workspace name.
				__( '%s sync is in progress' ),
				workspace.name
		  );

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
				{ showActivitySpinner ? (
					<Tooltip text={ activityTooltip }>
						<div
							role="status"
							aria-label={ activityLabel }
							className="grid h-8 w-7 place-items-center rounded-tr rounded-br"
						>
							<Spinner className="!m-0 !h-2.5 !w-2.5 [&>circle]:stroke-a8c-gray-70" />
						</div>
					</Tooltip>
				) : (
					localRunControl
				) }
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
