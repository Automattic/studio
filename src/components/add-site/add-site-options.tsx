import { Icon, create, preformatted, backup, chevronRight } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';

interface AddSiteOptionsProps {
	onOptionSelect: ( option: 'create' | 'blueprint' | 'backup' ) => void;
}

interface OptionButtonProps {
	icon: JSX.Element;
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
}

function OptionButton( {
	icon,
	title,
	description,
	onClick,
	disabled = false,
}: OptionButtonProps ) {
	return (
		<button
			className="m-auto w-full max-w-xl p-8 border border-gray-200 rounded-xl text-left hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-4"
			onClick={ onClick }
			disabled={ disabled }
		>
			<div className="mt-0.5">
				<Icon icon={ icon } size={ 24 } fill="#3858E9" />
			</div>
			<div className="flex flex-col gap-1 flex-1">
				<div className="text-xl font-medium text-gray-900">{ title }</div>
				<div className="text-base font-light text-gray-500">{ description }</div>
			</div>
			<div className="mt-0.5">
				<Icon icon={ chevronRight } size={ 24 } fill="#949494" />
			</div>
		</button>
	);
}

export default function AddSiteOptions( { onOptionSelect }: AddSiteOptionsProps ) {
	const { __ } = useI18n();

	return (
		<div className="text-center">
			<div className="text-4xl font-medium mb-4 text-gray-900">{ __( 'Add a site' ) }</div>
			<div className="text-xl font-light text-gray-500 mb-8 w-96 m-auto">
				{ __( 'Add a clean site, start from a blueprint or import site from a backup' ) }
			</div>
			<div className="space-y-4">
				<OptionButton
					icon={ create }
					title={ __( 'Create a site' ) }
					description={ __( 'Create a clean site' ) }
					onClick={ () => onOptionSelect( 'create' ) }
				/>
				<OptionButton
					icon={ preformatted }
					title={ __( 'Start from a blueprint' ) }
					description={ __( 'Choose one from the list or select your own' ) }
					onClick={ () => onOptionSelect( 'blueprint' ) }
				/>
				<OptionButton
					icon={ backup }
					title={ __( 'Import from a backup' ) }
					description={ __( 'Start a site from a backup' ) }
					onClick={ () => onOptionSelect( 'backup' ) }
				/>
			</div>
		</div>
	);
}
