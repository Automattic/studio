import { useI18n } from '@wordpress/react-i18n';
import { useAuth } from 'src/hooks/use-auth';
import { NonAuthenticatedAccountTab } from './non-authenticated-account-tab';
import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';
import { UserInfo } from './user-info';
import { WapuuScore } from './wapuu-score';
import type { ReactNode } from 'react';
import type { StudioExtensionAccountSection } from 'src/extensions/types';

function AccountSection( {
	children,
	description,
	title,
}: {
	children: ReactNode;
	description: string;
	title: string;
} ) {
	return (
		<section className="flex flex-col gap-4">
			<div>
				<h2 className="a8c-subtitle-small">{ title }</h2>
				<p className="mt-1 text-sm text-frame-text-secondary">{ description }</p>
			</div>
			<div className="flex flex-col gap-4">{ children }</div>
		</section>
	);
}

export const AccountTab = ( {
	loadingDeletingAllSnapshots,
	activeSnapshotCount,
	isLoadingSnapshotUsage,
	isOffline,
	snapshotQuota,
	onRemoveSnapshots,
	accountSections = [],
}: {
	loadingDeletingAllSnapshots: boolean;
	activeSnapshotCount: number;
	isLoadingSnapshotUsage: boolean;
	isOffline: boolean;
	snapshotQuota: number;
	onRemoveSnapshots: () => void;
	accountSections?: StudioExtensionAccountSection[];
} ) => {
	const { __ } = useI18n();
	const { isAuthenticated, user, logout } = useAuth();

	const wordpressComAccount = (
		<>
			{ isAuthenticated ? (
				<>
					<UserInfo onLogout={ logout } user={ user } />
					<SnapshotInfo
						isDeleting={ loadingDeletingAllSnapshots || isLoadingSnapshotUsage }
						isDisabled={
							activeSnapshotCount === 0 ||
							isOffline ||
							loadingDeletingAllSnapshots ||
							isLoadingSnapshotUsage
						}
						siteCount={ activeSnapshotCount }
						siteLimit={ snapshotQuota }
						onRemoveSnapshots={ onRemoveSnapshots }
					/>
					<PromptInfo />
					<WapuuScore />
				</>
			) : (
				<NonAuthenticatedAccountTab />
			) }
		</>
	);

	if ( ! accountSections.length ) {
		return wordpressComAccount;
	}

	return (
		<div className="flex flex-col gap-7">
			<AccountSection
				title={ __( 'WordPress.com' ) }
				description={ __( 'Used for Studio sync, preview sites, and Studio Code.' ) }
			>
				{ wordpressComAccount }
			</AccountSection>
			{ accountSections.map( ( section ) => {
				const Section = section.component;
				return (
					<AccountSection
						key={ section.id }
						title={ section.title }
						description={ section.description }
					>
						<Section />
					</AccountSection>
				);
			} ) }
		</div>
	);
};
