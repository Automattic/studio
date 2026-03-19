import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { CopyTextButton } from 'src/components/copy-text-button';
import { getIpcApi } from 'src/lib/get-ipc-api';

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
			<p className="a8c-body-small text-frame-text-secondary m-0">
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
				<DocLink label={ __( 'Windsurf' ) } url="https://docs.windsurf.com/windsurf/cascade/mcp" />
				{ ', ' }
				<DocLink
					label={ __( 'VS Code' ) }
					url="https://code.visualstudio.com/docs/copilot/chat/mcp-servers"
				/>
				.
			</p>
			<div className="relative">
				<pre className="bg-frame border border-frame-border rounded p-3 pr-16 text-xs overflow-x-auto whitespace-pre m-0 font-mono">
					{ configJson }
				</pre>
				<div className="absolute top-2 right-2">
					<CopyTextButton
						text={ configJson }
						variant="secondary"
						copyConfirmation={ __( 'Copied!' ) }
						showText
						label={ __( 'Copy' ) }
						className="!text-xs !min-h-0 !px-2 !py-1"
					/>
				</div>
			</div>
		</div>
	);
}
