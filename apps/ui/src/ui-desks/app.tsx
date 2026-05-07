import { useState } from 'react';
import { UserDeskChats } from './chats';
import { DeskChrome } from './chrome';
import {
	DeskOnboardingBlueprint,
	DeskOnboardingCreate,
	DeskOnboardingHome,
	DeskOnboardingImport,
} from './onboarding';
import { SiteDesk } from './site-desk';
import { UserDesk } from './user-desk';

type DeskScreen =
	| { type: 'user-desk' }
	| { type: 'site-desk'; siteId: string }
	| { type: 'onboarding-home' }
	| { type: 'onboarding-create' }
	| { type: 'onboarding-blueprint'; step: 'select' | 'configure' }
	| { type: 'onboarding-import'; step: 'select' | 'configure' };

export function DesksUiApp() {
	const [ chatsOpen, setChatsOpen ] = useState( false );
	const [ createChatRequestId, setCreateChatRequestId ] = useState( 0 );
	const [ screen, setScreen ] = useState< DeskScreen >( { type: 'user-desk' } );

	const showUserDesk = () => setScreen( { type: 'user-desk' } );
	const showSiteDesk = ( siteId: string ) => {
		setChatsOpen( false );
		setScreen( { type: 'site-desk', siteId } );
	};
	const showCreateFlow = () => setScreen( { type: 'onboarding-create' } );
	const showOnboardingHome = () => {
		setChatsOpen( false );
		setScreen( { type: 'onboarding-home' } );
	};
	const showBlueprintFlow = () => setScreen( { type: 'onboarding-blueprint', step: 'select' } );
	const showImportFlow = () => {
		setChatsOpen( false );
		setScreen( { type: 'onboarding-import', step: 'select' } );
	};

	const handleCreateChat = () => {
		setScreen( { type: 'user-desk' } );
		setChatsOpen( true );
		setCreateChatRequestId( ( requestId ) => requestId + 1 );
	};

	const isUserDesk = screen.type === 'user-desk';

	return (
		<div data-ui-mode="desks">
			{ isUserDesk ? (
				<>
					<DeskChrome
						chatsOpen={ chatsOpen }
						onToggleChats={ () => setChatsOpen( ( open ) => ! open ) }
						onCreateChat={ handleCreateChat }
						onCreateSite={ showOnboardingHome }
						onImportSite={ showImportFlow }
					/>
					<UserDeskChats
						open={ chatsOpen }
						onOpenChange={ setChatsOpen }
						createChatRequestId={ createChatRequestId }
					/>
				</>
			) : null }
			{ screen.type === 'user-desk' && <UserDesk /> }
			{ screen.type === 'site-desk' && (
				<SiteDesk siteId={ screen.siteId } onUserDashboard={ showUserDesk } />
			) }
			{ screen.type === 'onboarding-home' && (
				<DeskOnboardingHome
					onClose={ showUserDesk }
					onCreate={ showCreateFlow }
					onBlueprint={ showBlueprintFlow }
					onImport={ showImportFlow }
				/>
			) }
			{ screen.type === 'onboarding-create' && (
				<DeskOnboardingCreate
					onClose={ showUserDesk }
					onCancel={ showOnboardingHome }
					onSiteCreated={ showSiteDesk }
				/>
			) }
			{ screen.type === 'onboarding-blueprint' && (
				<DeskOnboardingBlueprint
					step={ screen.step }
					onStepChange={ ( step ) => setScreen( { type: 'onboarding-blueprint', step } ) }
					onClose={ showUserDesk }
					onCancel={ showOnboardingHome }
					onSiteCreated={ showSiteDesk }
				/>
			) }
			{ screen.type === 'onboarding-import' && (
				<DeskOnboardingImport
					step={ screen.step }
					onStepChange={ ( step ) => setScreen( { type: 'onboarding-import', step } ) }
					onClose={ showUserDesk }
					onCancel={ showOnboardingHome }
					onSiteCreated={ showSiteDesk }
				/>
			) }
		</div>
	);
}
