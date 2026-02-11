import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	Button,
	Modal,
	Notice,
} from '@wordpress/components';
import { Icon, caution, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { BlueprintValidationWarning } from '@studio/common/lib/blueprint-validation';

interface BlueprintIssuesModalProps {
	warnings: BlueprintValidationWarning[] | undefined;
	fileName: string;
	isOpen: boolean;
	onClose: () => void;
}

function BlueprintIssuesModal( {
	warnings,
	fileName,
	isOpen,
	onClose,
}: BlueprintIssuesModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			className="blueprints-issues-modal"
			title={ __( 'Blueprint details' ) }
			onRequestClose={ onClose }
			size="medium"
		>
			<VStack spacing={ 6 } className="h-full">
				<div className="flex items-center">
					<Icon className="fill-a8c-blue-50 me-2 shrink-0" icon={ check } />
					<Text className="font-medium text-gray-900">{ fileName }</Text>
				</div>
				<Text>
					{ warnings?.length &&
						__(
							'The following features are not supported in Studio and will be automatically removed:'
						) }
				</Text>
				<div className="flex-1 overflow-y-auto">
					<VStack spacing={ 3 }>
						{ warnings?.map( ( warningItem, index ) => (
							<div
								key={ index }
								className="rounded-sm p-3 border border-gray-200"
								style={ { backgroundColor: 'color-mix(in srgb, #d47608 4%, transparent)' } }
							>
								<HStack alignment="flex-start" spacing={ 2 }>
									<Icon icon={ caution } className="fill-[#a77f30] shrink-0 w-6 h-6" />
									<VStack spacing={ 1 } className="flex-grow py-0.5">
										<Text weight={ 500 }>{ warningItem.feature }</Text>
										<div>{ warningItem.reason }</div>
									</VStack>
								</HStack>
							</div>
						) ) }
					</VStack>
				</div>
				<div>
					<Text className="text-sm text-gray-600">
						{ __(
							'Your Blueprint will still work, but these features will be skipped during site creation.'
						) }
					</Text>
				</div>
				<HStack alignment="right">
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Got it' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}

interface BlueprintWarningNoticeProps {
	warnings: BlueprintValidationWarning[] | undefined;
	fileName: string;
	className?: string;
}

export function BlueprintWarningNotice( {
	warnings,
	fileName,
	className,
}: BlueprintWarningNoticeProps ) {
	const { __ } = useI18n();
	const [ showIssuesModal, setShowIssuesModal ] = useState( false );

	if ( ! warnings || warnings.length === 0 ) {
		return null;
	}

	return (
		<>
			<BlueprintIssuesModal
				warnings={ warnings }
				fileName={ fileName }
				isOpen={ showIssuesModal }
				onClose={ () => setShowIssuesModal( false ) }
			/>
			<Notice status="warning" isDismissible={ false } className={ className }>
				<div className="flex justify-between items-center w-full">
					<span>
						{ __(
							'This Blueprint uses unsupported features in Studio and might not work as expected.'
						) }
					</span>
					<Button
						variant="link"
						onClick={ () => setShowIssuesModal( true ) }
						className="!text-inherit !p-0 !underline"
					>
						{ __( 'View details' ) }
					</Button>
				</div>
			</Notice>
		</>
	);
}
