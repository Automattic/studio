import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

function CopyButton( { text }: { text: string } ) {
	const { __ } = useI18n();
	const [ copied, setCopied ] = useState( false );

	const handleCopy = async () => {
		await getIpcApi().copyText( text );
		setCopied( true );
		setTimeout( () => setCopied( false ), 2000 );
	};

	return (
		<Button variant="secondary" onClick={ handleCopy } className="!text-xs !min-h-0 !px-2 !py-1">
			{ copied ? __( 'Copied!' ) : __( 'Copy' ) }
		</Button>
	);
}

function DocLink( { label, url }: { label: string; url: string } ) {
	return (
		<Button variant="link" onClick={ () => getIpcApi().openURL( url ) }>
			{ label }
		</Button>
	);
}

export function McpSettings() {
	const { __ } = useI18n();
	const configJson = getMcpServerConfigJson();

	return (
		<div className="flex flex-col gap-4">
			<p className="a8c-body-small text-a8c-gray-700 m-0">
				{ __(
					"Copy the JSON configuration below and add it to your AI assistant's MCP settings. Setup guides:"
				) }{ ' ' }
				<DocLink label={ __( 'Claude Code' ) } url="https://code.claude.com/docs/en/mcp" />
				{ ', ' }
				<DocLink
					label={ __( 'Claude Desktop' ) }
					url="https://modelcontextprotocol.io/quickstart/user"
				/>
				{ ', ' }
				<DocLink label={ __( 'Codex' ) } url="https://developers.openai.com/codex/mcp" />
				{ ', ' }
				<DocLink
					label={ __( 'Cursor' ) }
					url="https://cursor.com/docs/mcp#installing-mcp-servers"
				/>
				{ ', ' }
				<DocLink
					label={ __( 'Windsurf' ) }
					url="https://windsurf.com/university/tutorials/configuring-first-mcp-server"
				/>
				{ ', ' }
				<DocLink
					label={ __( 'VS Code' ) }
					url="https://code.visualstudio.com/docs/copilot/chat/mcp-servers"
				/>
				.
			</p>
			<div className="relative">
				<pre className="bg-a8c-gray-0 border border-a8c-gray-200 rounded p-3 pr-16 text-xs overflow-x-auto whitespace-pre m-0 font-mono">
					{ configJson }
				</pre>
				<div className="absolute top-2 right-2">
					<CopyButton text={ configJson } />
				</div>
			</div>
		</div>
	);
}
