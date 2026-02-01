/**
 * Instruction file types supported by Studio.
 */
export type InstructionFileType = 'claude' | 'agents';

export interface InstructionFileConfig {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
}

/**
 * Configuration for each instruction file type.
 */
export const INSTRUCTION_FILES: Record< InstructionFileType, InstructionFileConfig > = {
	claude: {
		id: 'claude',
		fileName: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: 'Instructions for Claude Code',
	},
	agents: {
		id: 'agents',
		fileName: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
};

/**
 * All instruction file types in display order.
 */
export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'claude', 'agents' ];

/**
 * Legacy export for backwards compatibility.
 */
export const AGENTS_FILE_NAME = 'AGENTS.md';

/**
 * Template version - increment when making significant changes to instructions.
 * Format: YYYYMMDD.revision (e.g., 20250131.1)
 */
export const AGENT_INSTRUCTIONS_VERSION = '20250131.1';

/**
 * Extract version from instruction file content.
 */
export function extractInstructionVersion( content: string ): string | null {
	const match = content.match( /<!--\s*Studio Instructions Version:\s*([^\s]+)\s*-->/ );
	return match ? match[ 1 ] : null;
}

/**
 * Check if installed instructions are outdated.
 */
export function isInstructionVersionOutdated( installedVersion: string | null ): boolean {
	if ( ! installedVersion ) {
		return true; // No version = outdated
	}
	return installedVersion !== AGENT_INSTRUCTIONS_VERSION;
}

export const DEFAULT_AGENT_INSTRUCTIONS = `<!-- Studio Instructions Version: ${ AGENT_INSTRUCTIONS_VERSION } -->
# WordPress Studio Site

This is a local WordPress development site managed by WordPress Studio.

## Environment Details

**Database**: This site uses **SQLite** (not MySQL/MariaDB)
- Database file: \`wp-content/database/.ht.sqlite\`
- Managed by the SQLite Database Integration plugin
- Standard WordPress database operations work normally
- Use WP-CLI commands for database operations (\`studio wp db\` commands)

**Server**: WordPress Playground (PHP WebAssembly)
- Runs entirely in Studio's environment
- Supports standard WordPress functionality
- Full WP-CLI integration available

## Studio CLI Commands

**Site Management** (when run from this directory, site ID is auto-detected):
\`\`\`bash
studio site list                    # List all Studio sites
studio site start                   # Start this site
studio site stop                    # Stop this site
studio site status                  # Check site status
studio site open                    # Open site in browser (auto-login, starts if needed)
studio site open /wp-admin          # Open wp-admin
studio site open /my-page           # Open specific page
studio site open --no-login         # Open without auto-login
studio site set --hot-reload=true   # Enable hot reload (experimental)
studio site set --hot-reload=false  # Disable hot reload
\`\`\`

**WP-CLI Access** (full WordPress CLI):
\`\`\`bash
studio wp <command>                 # Run any WP-CLI command
studio wp plugin list               # List plugins
studio wp theme list                # List themes
studio wp db query "SELECT..."      # Run SQL queries
studio wp export                    # Export site content
\`\`\`

**WordPress.com Sync** (requires authentication):
\`\`\`bash
studio auth login                   # Authenticate with WordPress.com
studio sync list                    # Show connected sites
studio sync connect                 # Connect this site to WordPress.com
studio sync status                  # Check sync status
studio sync pull                    # Pull changes from WordPress.com
studio sync push                    # Push changes to WordPress.com
studio sync disconnect              # Disconnect from WordPress.com
\`\`\`

**Preview Sites** (temporary WordPress.com staging):
\`\`\`bash
studio preview create               # Create preview from this site
studio preview list                 # List your preview sites
studio preview update <host>        # Update existing preview
studio preview delete <host>        # Delete preview site
\`\`\`

**AI Assistance**:
\`\`\`bash
studio chat                         # Interactive WordPress AI chat
studio chat "your question"         # Single question to AI
\`\`\`

## Telex CLI (AI-Powered WordPress Development)

Telex is an AI environment for generating and editing WordPress themes, plugins, and blocks.

**Generate**:
\`\`\`bash
telex gen block <name>              # Generate a new block
telex gen plugin <name>             # Generate a new plugin
telex gen theme <name>              # Generate a new theme
\`\`\`

**Edit** (conversational editing):
\`\`\`bash
telex edit block <name>             # Edit a block interactively
telex edit plugin <name>            # Edit a plugin interactively
telex edit theme <name>             # Edit a theme interactively
\`\`\`

**Chat**:
\`\`\`bash
telex chat                          # Conversational WordPress development
\`\`\`

## Best Practices for AI Agents

1. **Always verify the database type**: This site uses SQLite, not MySQL
2. **Use WP-CLI via Studio**: Run \`studio wp\` commands instead of direct database access
3. **Check site status**: Run \`studio site status\` before making changes
4. **Test changes locally**: Start the site with \`studio site start\` to verify
5. **Use sync carefully**: Always pull before push when syncing with WordPress.com
6. **Leverage preview sites**: Use \`studio preview create\` for safe testing
7. **Auto-detect site**: Most commands work without specifying site ID when run from site directory
8. **Hot Reload (Experimental)**: Enable with \`studio site set --hot-reload=true\` to automatically see file changes:
   - CSS/JS changes inject instantly (no page reload)
   - PHP changes trigger smart page reload
   - Ideal for iterative AI development workflows

## Common Workflows

**Local Development**:
\`\`\`bash
studio site start                   # Start development server
studio wp plugin activate <name>    # Activate your plugin
studio site open                    # Open in browser (auto-login)
# Make changes to files...
studio site stop                    # Stop when done
\`\`\`

**AI Agent Development Loop**:
\`\`\`bash
studio site set --hot-reload=true   # Enable hot reload
# Edit plugin/theme files...
studio site open /my-plugin-page    # Open page to see changes
# Hot reload shows changes automatically
\`\`\`

**Deploy to WordPress.com**:
\`\`\`bash
studio sync connect                 # First time: connect to remote
studio sync pull                    # Get latest from remote
# Make local changes...
studio sync push                    # Deploy changes
\`\`\`

**Quick Testing**:
\`\`\`bash
studio preview create               # Create temporary test site
# Test at provided URL...
studio preview delete <host>        # Clean up when done
\`\`\`
`;
