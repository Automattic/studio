import { __ } from '@wordpress/i18n';
import ProgressBar from 'src/components/progress-bar';
import { useProgressTimer } from 'src/hooks/use-progress-timer';

interface ProgressRowProps {
	text: string;
	statusText?: string;
	progressConfig?: {
		initialProgress: number;
		paused: boolean;
		interval?: number;
		maxValue?: number;
	};
}

export function ProgressRow( {
	text,
	statusText = '-',
	progressConfig = {
		initialProgress: 60,
		paused: false,
		interval: 1500,
		maxValue: 95,
	},
}: ProgressRowProps ) {
	const { progress } = useProgressTimer( progressConfig );

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="w-[200px]">
						<div className="text-a8c-gray-70 a8c-body mb-4">{ text }</div>
						<ProgressBar value={ progress } maxValue={ 100 } />
					</div>
				</div>
				<div className="flex ml-auto">
					<div className="w-[110px] text-[#757575] flex items-center pl-4">{ statusText }</div>
					<div className="w-[100px] text-[#757575] flex items-center pl-4">{ '-' }</div>
					<div className="w-[60px] pr-2" />
				</div>
			</div>
		</div>
	);
}
