import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import type { PermissionRequest } from './studio-code-types';

interface StudioCodePermissionProps {
	permission: PermissionRequest;
	onRespond: ( id: string, answer: string ) => void;
}

export function StudioCodePermission( { permission, onRespond }: StudioCodePermissionProps ) {
	return (
		<div className="my-2 border border-yellow-400/50 rounded bg-yellow-50/10 p-3">
			<div className="font-medium text-sm mb-1">{ __( 'Permission Required' ) }</div>
			<p className="text-xs text-frame-text-secondary mb-2">{ permission.question }</p>
			<div className="flex gap-2">
				{ permission.options.map( ( option ) => (
					<Button
						key={ option }
						variant={ option.toLowerCase().startsWith( 'allow' ) ? 'primary' : 'secondary' }
						onClick={ () => onRespond( permission.id, option ) }
					>
						{ option }
					</Button>
				) ) }
			</div>
		</div>
	);
}
