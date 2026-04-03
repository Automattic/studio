---
name: taxonomist
description: AI-powered WordPress category taxonomy optimizer. Analyzes every post on a local WordPress site and suggests an improved category structure — merging duplicates, retiring dead categories, creating missing ones, writing descriptions, and re-categorizing posts. Invoke this skill when the user wants to optimize, clean up, reorganize, or improve their WordPress categories or taxonomy.
---

# Taxonomist

AI-powered WordPress category taxonomy optimizer. Analyzes every post on a WordPress site and suggests an improved category structure — merging duplicates, retiring dead categories, creating missing ones, and re-categorizing posts.

Based on [Taxonomist](https://github.com/m/taxonomist) by Matt Mullenweg.

## On Startup

When the user invokes this skill, introduce yourself:

> **Welcome to Taxonomist!** I'll analyze your WordPress categories and suggest improvements — merging duplicates, retiring dead categories, creating missing ones, and re-categorizing your posts using AI.
>
> Everything is safe: I'll preview all changes before doing anything, and log every modification so it can be reversed. Nothing touches your site until you approve it.

Then identify the target site. If there's only one local Studio site, use it automatically. If there are multiple, ask which one to analyze.

## How It Works

This skill operates through an interactive, step-by-step process on a local Studio site:

1. **Connect** — Identify the target local site and verify it's running
2. **Export** — Download all posts (full content) and categories to local JSON
3. **Backup** — Snapshot current taxonomy state before any changes
4. **Analyze** — Use parallel sub-agents to analyze every post's content and suggest optimal categories
5. **Plan** — Present a comprehensive category plan with descriptions
6. **Review** — Iterate with the user until the plan is approved
7. **Apply descriptions** — Update category descriptions first
8. **Apply categories** — Execute post re-categorization, logging every change
9. **Verify** — Confirm site integrity

**Steps 1-6 require NO write access to the site.** The site is only modified after explicit user approval.

## Working Directory

All data files go in a `taxonomist-data/` directory inside the site root:

```
{site_path}/taxonomist-data/
├── export/
│   ├── posts.json          # Exported posts with full content
│   └── categories.json     # Current category list
├── batches/
│   ├── batch-000.json      # Posts split into analysis batches
│   ├── batch-001.json
│   └── ...
├── results/
│   ├── batch-000-results.json
│   └── ...
├── backups/
│   └── pre-analysis-{timestamp}.json
└── logs/
    └── changes-{timestamp}.tsv
```

## Step 1: Connect

1. Use `studio site list --format json` to find available sites
2. If multiple sites exist, ask the user which one to analyze
3. Run `studio site status --path {site_path} --format json` to verify the site is running
4. If the site is stopped, start it: `studio site start --path {site_path} --skip-browser`
5. Verify WordPress is working: `studio wp --path {site_path} eval 'echo "OK";'`

## Step 2: Export

Create the working directory structure, then export posts and categories.

### Export categories

```bash
studio wp --path {site_path} term list category --format=json --fields=term_id,name,slug,description,count,parent
```

Save the output to `taxonomist-data/export/categories.json`.

### Export posts

Run the export script directly from the skill directory:

```bash
TAXONOMIST_OUTPUT={site_path}/taxonomist-data/export/posts.json \
studio wp --path {site_path} eval-file .agents/skills/taxonomist/scripts/export-posts.php
```

### Post-export summary

Report to the user:
- Total posts exported
- Total categories found
- Top 20 categories by post count
- Any categories with 0 posts (candidates for retirement)
- The default category (cannot be deleted without changing the setting first)

## Step 3: Backup

Create a full taxonomy snapshot before any analysis:

```bash
TAXONOMIST_OUTPUT={site_path}/taxonomist-data/backups/pre-analysis-$(date +%Y%m%d-%H%M%S).json \
studio wp --path {site_path} eval-file .agents/skills/taxonomist/scripts/backup.php
```

## Step 4: Analyze

Split exported posts into batches and analyze each batch with a sub-agent.

### Batch splitting

Read `taxonomist-data/export/posts.json` and split into batch files of ~20-50 posts each (adjust based on average post length — aim for batches that fit within a single agent context). Write each batch to `taxonomist-data/batches/batch-NNN.json`.

### Parallel analysis

For each batch, spawn a sub-agent (use the Agent tool with model "haiku" for efficiency) with this prompt:

> Analyze these blog posts and suggest optimal category assignments.
>
> **Existing categories:** {list from categories.json with slugs}
>
> **Instructions:**
> - Read the FULL content of each post, not just the title
> - Suggest 1-3 categories per post using category **slugs** (not display names)
> - Prefer existing categories over creating new ones
> - Only propose a new category if the topic is genuinely unserved AND would apply to multiple posts
> - Avoid generic catch-alls like "Uncategorized" or "General"
> - For each post, provide a confidence level: "high", "medium", or "low"
>
> **Output format** (JSON array):
> ```json
> [
>   {
>     "post_id": 123,
>     "cats": ["wordpress", "ai"],
>     "new_cats": [],
>     "confidence": "high"
>   }
> ]
> ```
>
> If proposing a new category, add it to `new_cats` with a suggested slug and name:
> ```json
> "new_cats": [{"slug": "machine-learning", "name": "Machine Learning"}]
> ```
>
> **Batch data:**
> {batch JSON content}

Save each sub-agent's output to `taxonomist-data/results/batch-NNN-results.json`.

### Aggregate results

After all batches complete:
1. Merge all result files, de-duplicating by post_id
2. Collect all proposed new categories across batches
3. Compute category frequency statistics
4. Save aggregated results to `taxonomist-data/results/aggregated.json`

## Step 5: Plan

Present a single comprehensive table showing the recommended action for every category:

| Category | Posts | Action | Description |
|----------|-------|--------|-------------|
| WordPress | 142 | **Keep** | Articles about WordPress development, plugins, and the WordPress ecosystem |
| Tech | 89 | **Keep** | Technology industry news, trends, and analysis |
| Asides | 34 | **Retire** → merge into "Notes" | Short-form posts and quick thoughts |
| Uncategorised | 23 | **Retire** → re-categorize | Posts to be assigned proper categories |
| Machine Learning | — | **Create** | Posts about ML, neural networks, and AI model training |

Include:
- **Every existing category** with its current post count and recommended action (Keep / Rename / Merge / Retire)
- **Every proposed new category** with expected post count
- **Proposed descriptions** for all categories (new and existing)
- A summary of how many posts would be re-categorized

Then show the **full dry run** — a table of every post that would change, showing old categories → new categories.

## Step 6: Review

Ask the user to review the plan. They may:
- Approve as-is
- Request changes to specific categories
- Ask to merge/split differently
- Adjust descriptions

Iterate until they approve. Do NOT proceed to Step 7 without explicit approval.

## Step 7: Apply Descriptions

After approval, first create any new categories and update descriptions:

```bash
# Create new categories
studio wp --path {site_path} term create category "Category Name" --slug=category-slug --description="Description here"

# Update existing category descriptions
studio wp --path {site_path} term update category {term_id} --description="Updated description"
```

## Step 8: Apply Categories

Prepare the suggestions JSON file from the approved plan, then run the apply script.

First, do a **preview** (dry run):

```bash
TAXONOMIST_SUGGESTIONS={site_path}/taxonomist-data/results/suggestions.json \
TAXONOMIST_LOG={site_path}/taxonomist-data/logs/changes-$(date +%Y%m%d-%H%M%S).tsv \
TAXONOMIST_MODE=preview \
studio wp --path {site_path} eval-file .agents/skills/taxonomist/scripts/apply-changes.php
```

Show the user the preview results. After they confirm:

```bash
TAXONOMIST_SUGGESTIONS={site_path}/taxonomist-data/results/suggestions.json \
TAXONOMIST_LOG={site_path}/taxonomist-data/logs/changes-$(date +%Y%m%d-%H%M%S).tsv \
TAXONOMIST_MODE=apply \
TAXONOMIST_REMOVE_CATS=uncategorized \
studio wp --path {site_path} eval-file .agents/skills/taxonomist/scripts/apply-changes.php
```

## Step 9: Verify

After applying changes:

1. List categories with counts: `studio wp --path {site_path} term list category --format=table --fields=term_id,name,slug,count`
2. Check for posts with no categories: `studio wp --path {site_path} eval 'echo count(get_posts(["posts_per_page" => -1, "category__in" => [get_option("default_category")]]));'`
3. Report the change log location to the user
4. Remind them that a full backup exists and can be restored

## Restoring from Backup

If the user wants to undo all changes:

```bash
TAXONOMIST_BACKUP={site_path}/taxonomist-data/backups/pre-analysis-{timestamp}.json \
studio wp --path {site_path} eval-file .agents/skills/taxonomist/scripts/restore.php
```

## Important Notes

- **Use `studio wp` for all WP-CLI commands** — bare `wp` will not work in Studio
- **Category slugs are the stable identifier** — always use slugs (not names or IDs) when referencing categories across steps
- **Never modify WordPress core files** — all changes go through WP-CLI commands
- **The default category cannot be deleted** — change it first via `studio wp option update default_category {new_id}` if needed
- **PHP scripts run in place** — scripts live in `.agents/skills/taxonomist/scripts/` and are executed directly via `eval-file`, no copying needed
- **All data stays local** — exported posts, analysis results, and backups remain in the site's `taxonomist-data/` directory
