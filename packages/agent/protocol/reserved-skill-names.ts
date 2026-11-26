// The names of Studio's own skills (`node/skills/<name>`). A skill of the user's can't take
// one: an agent would load Studio's skill instead. Listed here, not read from the skills, so
// the apps can check a name without loading them; a test keeps the two the same.
export const RESERVED_SKILL_NAMES = [
	'annotate',
	'block-content',
	'build-site',
	'create-skill',
	'edit-manage-remote-site',
	'edit-manage-site',
	'feedback',
	'headless-frontend',
	'hosting-plans-helper',
	'imagery',
	'liberate',
	'need-for-speed',
	'plugin-recommendations',
	'rank-me-up',
	'taxonomist',
	'visual-design',
	'visual-polish',
];
