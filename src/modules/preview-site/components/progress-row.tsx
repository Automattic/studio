import { __ } from '@wordpress/i18n';
import ProgressBar from 'src/components/progress-bar';
import { useSnapshots } from 'src/hooks/use-snapshots';

interface ProgressRowProps {
	text: string;
}

export function ProgressRow( { text }: ProgressRowProps ) {
	const { processingProgress } = useSnapshots();

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="w-[200px]">
						<div className="text-a8c-gray-70 a8c-body mb-4">{ text }</div>
						<ProgressBar value={ processingProgress } maxValue={ 100 } />
					</div>
				</div>
				<div className="flex ltr:ml-auto rtl:mr-auto">
					<div className="w-[150px] text-a8c-gray-700 flex items-center ltr:pl-4 rtl:pr-4">
						{ '-' }
					</div>
					<div className="w-[150px] text-a8c-gray-700 flex items-center ltr:pl-4 rtl:pr-4">
						{ '-' }
					</div>
					<div className="w-[60px] pr-2" />
				</div>
			</div>
		</div>
	);
}
