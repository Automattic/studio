import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { CopyTextButton } from 'src/components/copy-text-button';
import { LearnMoreLink } from 'src/components/learn-more';

export function McpSettings() {
	const { __ } = useI18n();
	const configJson = getMcpServerConfigJson();

	return (
		<div className="flex flex-col gap-4">
			<p className="a8c-body-small m-0">
				{ createInterpolateElement(
					__(
						"Connect your AI coding assistant to the Studio MCP to let it create, configure and interact with your local WordPress sites. Copy the JSON configuration below and add it to your assistant's MCP settings. <learn_more_link />"
					),
					{
						learn_more_link: <LearnMoreLink docsLinksKey="docsMcp" />,
					}
				) }
			</p>
			<div className="relative">
				<pre className="bg-frame border border-frame-border rounded p-3 pr-16 text-xs overflow-x-auto whitespace-pre m-0 font-mono select-text">
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
