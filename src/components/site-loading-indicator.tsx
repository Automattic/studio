import { useI18n } from '@wordpress/react-i18n';
import { useImportExport } from '../hooks/use-import-export';
import ProgressBar, { ProgressBarWithAutoIncrement } from './progress-bar';

export function SiteLoadingIndicator( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const { importState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = importState;
	const isImporting = !! currentProgress?.progress;

	const statusMessage = isImporting ? currentProgress.statusMessage : __( 'Creating site...' );

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto justify-center items-center">
			<div className="w-[300px] text-center">
				<div className="text-black a8c-subtitle-small mb-4">{ selectedSite.name }</div>
				{ isImporting ? (
					<ProgressBar value={ currentProgress.progress } maxValue={ 100 } />
				) : (
					<ProgressBarWithAutoIncrement initialValue={ 10 } increment={ 10 } maxValue={ 100 } />
				) }
				<div className="text-a8c-gray-70 a8c-body mt-4">{ statusMessage }</div>
			</div>
		</div>
	);
}
