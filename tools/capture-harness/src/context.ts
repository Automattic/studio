import type { Studio } from './drivers/types.ts';
import type { Profile } from './profile.ts';
import type { LoadedScene } from './scene.ts';
import type { Look } from './schema.ts';
import type { Page } from 'playwright';

/** What steps, captures and recordings act on: one running Studio. */
export interface Ctx {
	studio: Studio;
	// The window the app renders in.
	w: Page;
	profile: Profile;
	scene: LoadedScene;
	look: Look;
	// The signed-in account's email, rewritten on screen before every capture.
	email: string | null;
	// For `{{site.name}}`-style placeholders.
	vars: Record< string, unknown >;
	// Steps play at a watchable pace, for a recording.
	recording?: boolean;
}
