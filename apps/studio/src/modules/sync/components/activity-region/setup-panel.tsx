import { __ } from '@wordpress/i18n';
import { SyncDialogBody } from 'src/modules/sync/components/sync-dialog';
import { useSyncDialogTexts } from 'src/modules/sync/hooks/use-sync-dialog-texts';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import type { SyncSite } from '@studio/common/types/sync';
import type { TreeNode } from 'src/components/tree-view';

type SetupPanelProps = {
	site: {
		localSite: SiteDetails;
		remoteSite: SyncSite;
	};
	type: 'push' | 'pull';
	onPush: ( tree: TreeNode[] ) => void;
	onPull: ( tree: TreeNode[] ) => void;
	onRequestClose: () => void;
};

export function SetupPanel( { site, type, onPush, onPull, onRequestClose }: SetupPanelProps ) {
	const { localSite, remoteSite } = site;
	const siteEnv = getSiteEnvironment( remoteSite );
	const { title } = useSyncDialogTexts( type, siteEnv );

	return (
		<div>
			<div className="flex items-center justify-between px-4 py-2 border-b border-frame-border">
				<span className="a8c-subtitle-small text-frame-text">{ title }</span>
				<button
					type="button"
					className="text-frame-text-secondary hover:text-frame-text leading-none text-lg"
					onClick={ onRequestClose }
					aria-label={ __( 'Close' ) }
				>
					{ '×' }
				</button>
			</div>
			<div className="mx-auto w-full max-w-[48rem] [&_.py-4]:!py-1.5 [&_.pt-5]:!pt-2 [&_.pb-3]:!pb-2 [&_.pb-6]:!pb-3 [&_.pt-1]:!pt-0">
				<SyncDialogBody
					compact
					type={ type }
					localSite={ localSite }
					remoteSite={ remoteSite }
					onPush={ onPush }
					onPull={ onPull }
					onRequestClose={ onRequestClose }
				/>
			</div>
		</div>
	);
}
