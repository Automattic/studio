---
name: taxonomist
description: Analyze and optimize a WordPress site's category taxonomy. Exports all posts, uses AI to suggest an improved category structure — merging duplicates, retiring dead categories, creating missing ones, writing descriptions, and re-categorizing posts. Run this when the user wants to clean up or improve their categories.
user-invokable: true
tools: install_taxonomy_scripts
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

**Before anything else**, call the `install_taxonomy_scripts` tool with the target site to set up the PHP scripts.

## How It Works

This skill operates through an interactive, step-by-step process on a local Studio site:

1. **Connect** — Identify the target local site and verify it's running
2. **Export** — Download all posts (full content) and categories to local JSON
3. **Backup** — Snapshot current taxonomy state before any changes
4. **Analyze** — Use parallel sub-agents to analyze every post's content and suggest optimal categories
5. **Plan** — Present a comprehensive category plan with descriptions
6. **Review** — Iterate with the user on the plan
7. **Apply** — Preview, then save the categories and re-categorize the posts, logging every change
8. **Verify** — Confirm site integrity

Steps 1–6 only read the site. Step 7's apply is the one write, and Studio asks the user to approve it before it runs.

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

1. Use `site_list` to find available sites
2. If multiple sites exist, ask the user which one to analyze
3. Use `site_info` to verify the site is running
4. If the site is stopped, start it with `site_start`
5. Verify WordPress is working: `wp eval 'echo "OK";'`

## Step 2: Export

Create the working directory structure, then export posts and categories.

### Export categories

Run:
```
wp term list category --format=json --fields=term_id,name,slug,description,count,parent
```

Save the output to `taxonomist-data/export/categories.json`.

### Export posts

Run:
```
wp eval-file tmp/taxonomist/export-posts.php output={site_path}/taxonomist-data/export/posts.json
```

### Post-export summary

Report to the user:
- Total posts exported
- Total categories found
- Top 20 categories by post count
- Any categories with 0 posts (candidates for retirement)
- The default category (cannot be deleted without changing the setting first)

## Step 3: Backup

Create a full taxonomy snapshot before any analysis.

Run:
```
wp eval-file tmp/taxonomist/backup.php output={site_path}/taxonomist-data/backups/pre-analysis-{timestamp}.json
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

Present the plan and ask the user what they would change, with options like:
- "Looks good, preview the changes"
- "I want to adjust some categories first"
- "Cancel — don't make any changes"

Revise the plan with them until they are happy with it.

## Step 7: Apply

Save the plan as two files in `taxonomist-data/results/`:
- `categories.json`: the categories to create, and the new names or descriptions of existing ones, by slug: `[{"slug": "machine-learning", "name": "Machine Learning", "description": "..."}]`
- `suggestions.json`: each post's categories, by slug: `[{"post_id": 123, "cats": ["wordpress", "ai"]}]`

Preview the changes (the default mode changes nothing) and show the user the result:

```
wp eval-file tmp/taxonomist/apply-changes.php \
  suggestions={site_path}/taxonomist-data/results/suggestions.json \
  categories={site_path}/taxonomist-data/results/categories.json \
  log={site_path}/taxonomist-data/logs/preview-{timestamp}.tsv
```

Then run it with `mode=apply`, adding `remove=` with the slugs to strip from re-categorized posts (such as `remove=uncategorized`). Studio asks the user to approve it before it runs:

```
wp eval-file tmp/taxonomist/apply-changes.php \
  suggestions={site_path}/taxonomist-data/results/suggestions.json \
  categories={site_path}/taxonomist-data/results/categories.json \
  log={site_path}/taxonomist-data/logs/changes-{timestamp}.tsv \
  mode=apply remove=uncategorized
```

## Step 8: Verify

After applying changes:

1. List categories with counts: `wp term list category --format=table --fields=term_id,name,slug,count`
2. Check for posts with no categories: `wp eval 'echo count(get_posts(["posts_per_page" => -1, "category__in" => [get_option("default_category")]]));'`
3. Report the change log location to the user
4. Remind them that a full backup exists and can be restored

## Restoring from Backup

If the user wants to undo all changes, run:

```
wp eval-file tmp/taxonomist/restore.php backup={site_path}/taxonomist-data/backups/pre-analysis-{timestamp}.json
```

## Important Notes

- **Manage sites with the Studio tools** (`site_list`, `site_info`, `site_start`) and run the WP-CLI commands above with `wp`
- **Category slugs are the stable identifier** — always use slugs (not names or IDs) when referencing categories across steps
- **The default category cannot be deleted** — change it first with `wp option update default_category {new_id}` if needed
- **All data stays local** — exported posts, analysis results, and backups remain in the site's `taxonomist-data/` directory
