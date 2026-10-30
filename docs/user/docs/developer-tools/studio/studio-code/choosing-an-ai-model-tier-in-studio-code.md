# Choosing an AI model tier in Studio Code

## [The short version](#0-the-short-version)

Studio Code no longer asks you to pick an AI model by name. Instead, you pick how much depth the job needs:

| Tier | What it’s for | Can use free allowance? |
| --- | --- | --- |
| Fast | Everyday changes: small edits, quick fixes, straightforward requests | Yes |
| Balanced | Work that benefits from more careful reasoning, without the cost of the top tier | No, requires purchased credits |
| Strong | Complex, high-stakes, or architecture-level work | No, requires purchased credits |

You can switch tiers at any point in a conversation, including mid-task. Studio uses whichever tier is selected for each new message.

[![The Studio Code model menu open above the chat box, with Fast selected and Balanced and Strong grayed out, and Get more credits and Connect provider listed under Actions.](https://developer.wordpress.com/wp-content/uploads/2026/09/model-menu.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2026/09/model-menu.webp)

The models behind each tier are updated as newer models become available. For example, Studio 1.23 moved Balanced and Strong to newer models. You don’t need to change anything when this happens: you keep choosing by tier.

## [All tiers use AI credits](#1-all-tiers-use-ai-credits)

Every message in Studio Code spends AI credits, whichever tier you choose. Balanced and Strong use credits at a higher rate than Fast.

Every account starts with a one-time allowance of free [AI credits](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/). The free allowance can only be spent on the Fast tier. When they run out, you’ll need to purchase AI credits to keep using Studio Code, including Fast.

## [Balanced and Strong require purchased credits](#2-balanced-and-strong-require-purchased-credits)

Balanced and Strong are only available to accounts that have purchased AI credits. This applies even if you still have free allowance left, because those can’t be spent on the stronger tiers. Until you’ve purchased credits, the desktop model menu shows Balanced and Strong as **Purchased credits required** and doesn’t let you pick them, and the terminal’s `/model` command hides them with a note to add credits. To buy credits in the desktop app, choose **Get more credits** from the model menu.

Once you’ve purchased AI credits, the model picker keeps Balanced and Strong unlocked, even after your purchased balance is spent. When you use Fast, any remaining free allowance is spent first, before your purchased balance. You don’t need to top up between sessions, only when you run out.

## [How credit consumption actually works](#3-how-credit-consumption-actually-works)

-   **Every reply costs credits — including when you continue an existing conversation.** There’s no free “continue” action once a conversation has started; Studio Code doesn’t distinguish between a brand-new question and the fifth follow-up in the same thread.
-   **Cost isn’t a flat per-message fee.** It scales with how much the model has to read (your prompt, plus the conversation and project context it’s carrying) and how much it has to write in response. A short, targeted request costs less than one that requires the model to work through a lot of surrounding code or produce a long answer.
-   **Stronger tiers cost more per turn.** Balanced and Strong use more capable models that cost more to run, so the same question costs more on Strong than on Fast, even a trivial one.
-   **Switching tiers doesn’t change what you already spent.** Cost is locked in per message, at the tier that was active when you sent it. Moving from Fast to Strong partway through a conversation only affects what you send from that point on.
-   **Longer-running or more exploratory work adds up faster than a single question would suggest.** If a task involves several rounds of back-and-forth, retries, or the model investigating before it acts, each round is its own cost, on top of the original request.

Studio Code doesn’t show you exactly how many credits any given reply costs in advance—what it costs depends on what you asked and how the model chose to answer, and that can vary. What you can rely on is the balance itself, which updates as you go (see below), and the relative ordering: Fast is the cheapest way to get something done, Strong is the most expensive, Balanced sits in between.

## [Keeping an eye on your balance](#4-keeping-an-eye-on-your-balance)

Studio Code shows a running AI credits meter as you work, combining whatever’s left of your free allowance with anything you’ve purchased. When you’re getting close to empty, Studio Code will tell you before you run out entirely.

When your purchased balance runs out, Balanced and Strong stay unlocked in the model picker, but because the free allowance only funds Fast, you need to add more AI credits to keep using them. Fast keeps working as long as the free allowance remains. When both are empty, Studio Code stops until you add more AI credits. Add credits from inside Studio Code, or see [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/) for how purchases, refunds, and account rules work.

## [FAQ](#5-faq)

**Does starting a new conversation cost more than continuing an old one?** No — cost depends on what’s being read and written in that specific turn, not on whether the conversation is new. A long-running conversation can cost more per reply than a fresh one simply because the model has more context to carry, but that’s a side effect of size, not age.

**Can I use different tiers in the same project, or even the same conversation?** Yes. Tier is a per-message choice. A common pattern is starting a task on Fast and switching to Balanced or Strong only for the parts that need it.

**Why can’t I switch to Balanced or Strong even though I still have free allowance left?** The free allowance only funds Fast. Balanced and Strong unlock only once your account has purchased AI credits, however much free allowance remains.