---
name: feedback
description: Send the user's feedback about WordPress Studio to the Studio team — a bug, a feature request, or general feedback — with the context from this chat. Use this when the user invokes /feedback, asks to report something to the Studio team, or agrees to send feedback after a Studio tool failed.
user-invokable: true
---

# Send feedback

Turn what the user wants to tell the Studio team into one plain-language report, show it to them, and send it with `send_feedback` only after they say yes.

Feedback reaches a real queue the Studio team reads. The user decides what goes in it, and nothing is sent without their explicit OK.

## 1. Find out what to report

When the user invoked `/feedback` with text after it, that text is the feedback. When they invoked it bare, ask in one short question what they want to tell the Studio team, and offer the three kinds: something broken, something they wish Studio did, or anything else.

Do not ask for details you already have. This chat usually holds them: what the user was trying to do, which Studio tool ran, and the error it returned.

## 2. Draft the report

Write the message for a Studio engineer who was not in this chat:

- What the user was trying to do.
- What happened, with the Studio tool name and the exact error message when there is one.
- What they expected instead.
- For a feature request: what they want to do and why.

Pick the type: `bug` for something broken, `request` for a feature or improvement, `general` for anything else, including praise.

Offer a chat summary. If this chat has work in it (tools ran, errors came back, a site was built or changed), add a short section headed **What happened in this chat**: the steps taken in order, the Studio tools called, and any errors, in a few lines. Leave it out when the chat is only the feedback request itself. Include the raw transcript only when the user asks for it, since it can hold private content; a summary is usually enough to reproduce the problem.

Leave out passwords, API keys, tokens and private site content unless the user asks to include them. Do not add the Studio version or operating system: the tool adds them.

## 3. Show it and ask

Show the user the exact message and type you would send, then ask whether to send it. Wait for the answer.

- **Yes**: call `send_feedback` once with that type and message.
- **Changes**: apply them, show the new message, and ask again.
- **No**: do not call the tool, say nothing was sent, and stop.

Never call `send_feedback` before the user has approved the exact message, and never call it twice for the same report.

## 4. Report the result

The tool returns a feedback ID. Tell the user the feedback was sent and give the ID, so they can refer to it. The Studio team reviews reports in batches, so there is no immediate reply.

If the tool fails because the user is not logged in to WordPress.com, say so, tell them to log in (`studio auth login` in a terminal, or Settings → AI in the Studio app) and then run `/feedback` again, and offer the GitHub issue form the error names as an alternative. For any other failure, give the error and offer to try again or to use the GitHub form.
