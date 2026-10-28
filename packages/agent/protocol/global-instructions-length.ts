// Keep the always-injected instructions small enough that they can't crowd out
// the rest of the system prompt. The prompt builder truncates anything longer;
// the settings UIs cap their textareas at the same length. Its own module so
// the UI can import it without the Node file access next to it.
export const GLOBAL_INSTRUCTIONS_MAX_LENGTH = 16_000;
