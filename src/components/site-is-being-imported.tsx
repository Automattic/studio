import { useI18n } from '@wordpress/react-i18n';
import ProgressBar from 'src/components/progress-bar';
import { useImportExport } from 'src/hooks/use-import-export';

export function SiteIsBeingImported( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const { importState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = importState;

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto justify-center items-center">
			<div className="w-[300px] text-center">
				<div className="text-black a8c-subtitle-small mb-4">{ selectedSite.name }</div>
				<ProgressBar value={ currentProgress.progress } maxValue={ 100 } />
				<div className="text-a8c-gray-70 a8c-body mt-4">{ currentProgress.statusMessage }</div>
			</div>
		</div>
	);
}
