import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SettingsFormField } from 'src/modules/user-settings/components/settings-form-field';

export function McpSettings() {
	const { __ } = useI18n();
	const [ copied, setCopied ] = useState( false );
	const configJson = getMcpServerConfigJson();

	const handleCopy = async () => {
		await getIpcApi().copyText( configJson );
		setCopied( true );
		setTimeout( () => setCopied( false ), 2000 );
	};

	return (
		<SettingsFormField label={ __( 'AI MCP Server' ) }>
			<div className="a8c-body-small text-a8c-gray-700">
				{ __(
					'Copy the configuration below and add it under the "mcpServers" key in your AI assistant\'s MCP settings.'
				) }
			</div>
			<div className="relative">
				<pre className="bg-a8c-gray-0 border border-a8c-gray-200 rounded p-3 text-xs overflow-x-auto whitespace-pre m-0 font-mono">
					{ configJson }
				</pre>
				<div className="absolute top-2 right-2">
					<Button
						variant="secondary"
						onClick={ handleCopy }
						className="!text-xs !min-h-0 !px-2 !py-1"
					>
						{ copied ? __( 'Copied!' ) : __( 'Copy' ) }
					</Button>
				</div>
			</div>
		</SettingsFormField>
	);
}
