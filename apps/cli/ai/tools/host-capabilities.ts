import type { DesignTracksContext } from 'cli/ai/design-tracks';
import type { AskUserHandler } from 'cli/ai/types';

// What the agent host running the Studio tools can do. Each runtime (pi for
// Studio Code, MCP for Codex and other external agents) describes itself once;
// the tool list and the prompt are both derived from it.
export interface HostCapabilities {
	// A Studio UI is attached and renders chat artifacts from tool results.
	chatArtifacts?: boolean;
	// Reloads the site preview the user is watching. Absent when none is attached.
	reloadPreview?: () => Promise< void >;
	// Asks the user through the host and waits for the answers. Absent when the
	// host's agent asks in its own conversation instead, or cannot ask at all.
	askUser?: AskUserHandler;
	// The user can be asked at all, so pick_design offers options to pick from.
	canAskUser?: boolean;
	// How present_design_options shows rendered previews: `ask` shows them and
	// waits for the pick through `askUser`; `return` hands them back for the
	// host's agent to show and ask about. Absent: previews cannot be shown.
	designPreviews?: 'ask' | 'return';
	// How the host shows returned previews: `picker`, as a clickable picker of
	// its own (an MCP App) attached to present_design_options; `widget`, as an
	// inline HTML widget its agent renders with a tool of its own. Absent: as a
	// grid image, with the question asked in the agent's reply.
	designOptionsView?: 'picker' | 'widget';
	// A folder the host can display images from in its conversation; images
	// meant for the user are copied there. Absent: they are shown from where
	// they were saved.
	displayDirectory?: () => Promise< string | undefined >;
	// Studio generates images (WordPress.com login or STUDIO_IMAGE_API_TOKEN).
	imageGeneration?: boolean;
	// The host renders images with this tool of its own: generate_images then
	// returns the prompts for it instead of calling Studio's image API.
	hostImageTool?: string;
	// The host brings its own images, imported with import_images.
	importImages?: boolean;
	// False for models that cannot view images. Defaults to true.
	visionEnabled?: boolean;
	// Skills are loaded through the Skill tool.
	skills?: boolean;
	// The chat session the design tools record Tracks events for.
	tracks?: DesignTracksContext;
}
