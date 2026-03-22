import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import type { PermissionRequest } from './studio-code-types';

interface StudioCodePermissionProps {
	permission: PermissionRequest;
	onRespond: ( id: string, allowed: boolean ) => void;
}

export function StudioCodePermission( { permission, onRespond }: StudioCodePermissionProps ) {
	return (
		<div className="my-2 border border-yellow-400/50 rounded bg-yellow-50/10 p-3">
			<div className="font-medium text-sm mb-1">{ __( 'Permission Required' ) }</div>
			<p className="text-xs text-frame-text-secondary mb-2">{ permission.description }</p>
			<div className="text-xs mb-2">
				<span className="text-frame-text-secondary">{ __( 'Tool: ' ) }</span>
				<span className="font-mono">{ permission.toolName }</span>
			</div>
			{ Object.keys( permission.input ).length > 0 && (
				<pre className="bg-frame p-1.5 rounded text-[11px] overflow-x-auto whitespace-pre-wrap mb-2">
					{ JSON.stringify( permission.input, null, 2 ) }
				</pre>
			) }
			<div className="flex gap-2">
				<Button variant="primary" onClick={ () => onRespond( permission.id, true ) }>
					{ __( 'Allow' ) }
				</Button>
				<Button variant="secondary" onClick={ () => onRespond( permission.id, false ) }>
					{ __( 'Deny' ) }
				</Button>
			</div>
		</div>
	);
}
