---
name: create-skill
description: Make a new skill of the user's own from what they describe — a repeatable way to do a task, which agents load later by its description or its `/name` command. Use this when the user invokes /create-skill, or asks to make, save or teach a skill, or to do a task the same way every time from now on.
---

# Create a skill

A skill is the user's own runbook: a name, a description that says when to use it, and the steps to follow. Studio keeps it as a folder with a `SKILL.md` file, and agents load it when a request matches the description or when the user types `/` and its name.

Turn what the user wants into one skill and save it with `save_skill`.

## 1. Find out what the skill does

When the user invoked `/create-skill` with text after it, that text is the task. When they invoked it bare, ask in one short question what the skill must do.

Use what this chat already holds. If you and the user just did the task together, the steps are here: the choices they made, the names they used, what they corrected. Ask only for what you cannot infer, and never more than two questions.

## 2. Ask where it works

A skill works on one site or on all sites:

- **This site only**: for a task tied to this site's content, design or plugins. The skill is saved in the site's folder and moves with the site.
- **All sites**: for a way of working the user wants everywhere, such as a writing voice or a launch checklist.

Ask in one short question, and name the active site in it. Do not ask when the user already said which, or when there is no local site in this chat: then it is for all sites.

## 3. Write the skill

- **Name**: two to four plain words that say the task, such as "Lookbook post". The command comes from it (`/lookbook-post`), so keep it short and easy to type.
- **Description**: one or two sentences. Say what the skill does and when to use it, in the words the user would ask with. Agents choose the skill by this text alone, so a vague description means the skill is never used.
- **Instructions**: Markdown for an agent that has not seen this chat.
  - Start with a `#` title and one line that says when to use the skill.
  - Then numbered steps, in the order to do them.
  - Use the real names: the category, the pattern, the page, the file path. "The Moiré gallery pattern", not "the usual gallery".
  - Say what to ask the user for when it is not given, and what the finished work must look like.
  - Leave out what any agent already knows about WordPress. Keep only what is particular to this user or this site.
  - Never put passwords, API keys or tokens in a skill.
  - Keep it short: most skills need fewer than 60 lines.

## 4. Save it

Call `save_skill` once, with `scope` set to `site` (and the active site) or `all_sites`. Do not write the file yourself.

If the name is taken, do not replace the other skill: pick another name that still says the task and save again. If the user wanted to change the skill that exists, load it with the Skill tool, which says where it is, and edit its `SKILL.md`.

## 5. Tell the user

In two sentences: the skill's name and where it is saved (the site's name, or all sites), then that they can type its command to use it, and where they change it, as the result of `save_skill` says. Give the command in backticks. The skill is ready from their next message.
