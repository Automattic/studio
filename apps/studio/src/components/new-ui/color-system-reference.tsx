interface Token {
	css: string;
	tw: string;
	desc: string;
}

const CHROME_TOKENS: Token[] = [
	{ css: '--color-chrome-bg', tw: 'bg-chrome', desc: 'Window / navigation background' },
	{ css: '--color-chrome-text', tw: 'text-chrome-text', desc: 'Primary text on chrome' },
	{
		css: '--color-chrome-text-secondary',
		tw: 'text-chrome-text-secondary',
		desc: 'Secondary text on chrome',
	},
	{
		css: '--color-chrome-text-tertiary',
		tw: 'text-chrome-text-tertiary',
		desc: 'Muted / placeholder text',
	},
	{ css: '--color-chrome-surface', tw: 'bg-chrome-surface', desc: 'Hover / selected surfaces' },
	{
		css: '--color-chrome-surface-hover',
		tw: 'bg-chrome-surface-hover',
		desc: 'Subtle hover background',
	},
	{ css: '--color-chrome-border', tw: 'border-chrome-border', desc: 'Borders on chrome' },
	{ css: '--color-chrome-active', tw: 'bg-chrome-active', desc: 'Active / selected state' },
];

const FRAME_TOKENS: Token[] = [
	{ css: '--color-frame-bg', tw: 'bg-frame', desc: 'Panel / content background' },
	{ css: '--color-frame-text', tw: 'text-frame-text', desc: 'Primary text' },
	{
		css: '--color-frame-text-secondary',
		tw: 'text-frame-text-secondary',
		desc: 'Secondary / muted text',
	},
	{ css: '--color-frame-border', tw: 'border-frame-border', desc: 'Borders and dividers' },
	{
		css: '--color-frame-surface',
		tw: 'bg-frame-surface',
		desc: 'Elevated surfaces, hover states',
	},
	{ css: '--color-frame-surface-alt', tw: 'bg-frame-surface-alt', desc: 'Alternate surface' },
	{ css: '--color-frame-theme', tw: 'text-frame-theme', desc: 'Accent / interactive color' },
	{
		css: '--color-frame-theme-hover',
		tw: 'text-frame-theme-hover',
		desc: 'Accent hover state',
	},
	{ css: '--color-frame-code-text', tw: 'text-frame-code-text', desc: 'Code / monospace text' },
	{ css: '--color-frame-running', tw: 'text-frame-running', desc: 'Running / success status' },
	{ css: '--color-frame-error', tw: 'text-frame-error', desc: 'Error / destructive' },
	{
		css: '--color-frame-tab-active',
		tw: 'border-frame-tab-active',
		desc: 'Active tab indicator',
	},
];

function Swatch( { cssVar }: { cssVar: string } ) {
	return (
		<div
			className="w-8 h-8 rounded border border-chrome-border flex-shrink-0"
			style={ { backgroundColor: `var(${ cssVar })` } }
		/>
	);
}

function TokenTable( { tokens, title }: { tokens: Token[]; title: string } ) {
	return (
		<div>
			<h4 className="a8c-label text-chrome-text-secondary mb-3">{ title }</h4>
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="border-b border-chrome-border">
						<th className="pb-2 font-medium text-chrome-text-secondary">Color</th>
						<th className="pb-2 font-medium text-chrome-text-secondary">Token</th>
						<th className="pb-2 font-medium text-chrome-text-secondary">Tailwind</th>
						<th className="pb-2 font-medium text-chrome-text-secondary">Usage</th>
					</tr>
				</thead>
				<tbody>
					{ tokens.map( ( t ) => (
						<tr key={ t.css } className="border-b border-chrome-border/50">
							<td className="py-2">
								<Swatch cssVar={ t.css } />
							</td>
							<td className="py-2 font-mono text-chrome-text-secondary">{ t.css }</td>
							<td className="py-2 font-mono text-chrome-text-secondary">{ t.tw }</td>
							<td className="py-2 text-chrome-text-secondary">{ t.desc }</td>
						</tr>
					) ) }
				</tbody>
			</table>
		</div>
	);
}

export function ColorSystemReference() {
	return (
		<div className="space-y-8 text-sm text-chrome-text">
			<div>
				<h3 className="a8c-subtitle-small text-chrome-text mb-1">Color System</h3>
				<p className="a8c-body text-chrome-text-secondary mb-4">
					Defined in <code className="bg-chrome-surface px-1 rounded">index.css</code> as
					CSS custom properties, mapped to Tailwind in{ ' ' }
					<code className="bg-chrome-surface px-1 rounded">tailwind.config.js</code>.
					Tokens adapt automatically based on the active color scheme.
				</p>
			</div>

			<TokenTable tokens={ CHROME_TOKENS } title="Chrome tokens" />
			<TokenTable tokens={ FRAME_TOKENS } title="Frame tokens" />

			<div className="text-xs text-chrome-text-secondary space-y-1">
				<p>
					Scrollbar colors (
					<code className="bg-chrome-surface px-1 rounded">--color-frame-scrollbar-*</code>
					) are defined in CSS but not mapped to Tailwind — they're used directly in{ ' ' }
					<code className="bg-chrome-surface px-1 rounded">index.css</code> scrollbar
					styles.
				</p>
			</div>
		</div>
	);
}
