# GitHub CLI (`gh`) for issues — end to end

Practical cheat-sheet for issue work on this repo. Commands marked **(verified)** were run on this machine against `rajofearth/muxics` (read-only) and their output confirmed; everything else is from the sources cited.

**Environment (verified):**
- `gh version 2.87.3 (2026-02-23)` — `gh --version`
- Auth: `gh auth status` → logged in as `rajofearth` (keyring), scopes `gist`, `read:org`, `repo`, `workflow`
- Repo: `git remote -v` → `origin https://github.com/rajofearth/winamp-player`; the repo was **renamed to `rajofearth/muxics`** (see §7)

**Sources:** local `gh <cmd> --help` output (2.87.3), the manual at <https://cli.github.com/manual>, GitHub docs at <https://docs.github.com/en/rest>, and the gh CLI source at `github.com/cli/cli` tag `v2.87.3`.

---

## 1. Core issue commands

`gh issue <command>` — manual root: <https://cli.github.com/manual/gh_issue>. An issue can be given as a number, a URL, or `OWNER/REPO#N`.

| Command | Purpose | Key flags |
|---|---|---|
| `create` | New issue. Alias `new`. | `-t/--title`, `-b/--body`, `-F/--body-file` (`-` = stdin), `-l/--label`, `-a/--assignee` (`@me`, `@copilot`), `-m/--milestone`, `-p/--project`, `-T/--template`, `-e/--editor`, `-w/--web`, `--recover` (rescue a failed run) — <https://cli.github.com/manual/gh_issue_create> |
| `list` | List issues. Alias `ls`. | `-s/--state` `{open\|closed\|all}` (default open), `-l/--label`, `-a/--assignee`, `-A/--author`, `-m/--milestone`, `-S/--search`, `--mention`, `--app`, `-L/--limit` (default 30), `--json`/`--jq`/`--template`, `-w/--web` — <https://cli.github.com/manual/gh_issue_list> |
| `status` | Issues assigned/created/mentioned for **you**. | `--json`, `--jq` |
| `view` | Show one issue. | `-c/--comments`, `-w/--web`, `--json`, `--jq`, `--template` — <https://cli.github.com/manual/gh_issue_view> |
| `edit` | Edit one **or more** issues (`gh issue edit 23 34 ...`). Interactive if no flags. | `-t`, `-b`, `-F`, `--add-label/--remove-label`, `--add-assignee/--remove-assignee`, `-m/--milestone`, `--remove-milestone`, `--add-project/--remove-project` — <https://cli.github.com/manual/gh_issue_edit> |
| `close` | Close. | `-c/--comment` (closing comment), `-r/--reason` `{completed\|not planned}` |
| `reopen` | Reopen. | `-c/--comment` |
| `comment` | Comment. | `-b/--body`, `-F/--body-file`, `--edit-last`, `--delete-last`, `--create-if-none` (with `--edit-last`), `-e`, `-w`, `--yes` |
| `delete` | Delete (irreversible). | `--yes` |
| `transfer` | Move to another repo. | `<number> <destination-repo>` |
| `pin` / `unpin` | Pin/unpin to repo. | — |
| `lock` / `unlock` | Lock/unlock conversation. | `lock -r/--reason` `{off_topic\|resolved\|spam\|too_heated}` |
| `develop` | Linked dev branches. | `-l/--list`, `-n/--name`, `-b/--base`, `-c/--checkout`, `--branch-repo` |

**Not in 2.87.3:** `gh issue edit` has **no** `--add-sub-issue` / `--parent` / `--add-blocked-by` flags yet — those exist only in unreleased gh trunk (verified against `pkg/cmd/issue/edit/edit.go` at tag `v2.87.3` vs `trunk`). Use `gh api` for sub-issues today (§5).

## 2. Bodies: quoting, heredocs, rewriting

**The pitfall (hit for real):** inside **double quotes**, the shell evaluates backticks, `$(...)`, and `$VAR`. A backtick-wrapped token in `--body "...`foo`..."` was executed as a command and **vanished from the comment**. Same for `$` in shell or PowerShell.

- **Rule 1:** single-quote inline bodies: `--body 'literal $VAR and `backtick` survive'` (in PowerShell, single quotes are also literal).
- **Rule 2:** for anything multi-line, never fight the shell — use `--body-file` with a quoted heredoc delimiter (quoted `'EOF'` stops all expansion):

```sh
gh issue create --title "Map: X" --label wayfinder:map --body-file - <<'EOF'
## Scope
...
## Decisions
- [ ] ...
EOF
```

- **Rewrite a body** (full replace, not append): `gh issue edit <n> --body-file body.md` or `--body-file - <<'EOF' … EOF`.
- **Closed issues:** `gh issue edit <n> --body-file f` **does rewrite the body of a closed issue**. The edit path (`prShared.UpdateIssue` in v2.87.3 source) issues an `updateIssue` GraphQL mutation / REST `PATCH /repos/{owner}/{repo}/issues/{issue_number}` with **no state check** — GitHub's update-issue endpoint is explicitly editable in any state (`state` itself is just a body param; <https://docs.github.com/en/rest/issues/issues#update-an-issue>). Not write-tested here (read-only constraint) — sanity-check once on a throwaway issue.
- **Templates:** `gh issue create --template "Name"` seeds the body from `.github/ISSUE_TEMPLATE/*.md` (or issue forms `.yml`). **This repo has no `.github/ISSUE_TEMPLATE` dir yet** (only `workflows`), so `--template` has nothing to pick from — add one to enable it (<https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository>).
- `--body` and `--body-file` are mutually exclusive (edit.go, v2.87.3).

## 3. Reading

```sh
gh issue view 34                       # title, body, labels, state
gh issue view 34 --comments            # + all comments (conventions doc default)
gh issue view 34 --json number,title,body,labels,state --jq '{n: .number, t: .title, labels: [.labels[].name]}'

gh issue list --state open --label wayfinder:map
gh issue list --state all --milestone "1.0" --limit 100
gh issue list --json number,title,state --jq '.[] | "\(.number)\t\(.state)\t\(.title)"'
```

`gh search issues` searches **across repos** with search-syntax qualifiers — <https://cli.github.com/manual/gh_search_issues>; syntax: <https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests>:

```sh
gh search issues "benchmark" --repo rajofearth/muxics --state open --limit 50
gh search issues --label wayfinder:task --no-assignee --repo rajofearth/muxics
```

## 4. JSON & scripting

**`--json` fields** (`view`/`list`/`status` — same set): `assignees, author, body, closed, closedAt, closedByPullRequestsReferences, comments, createdAt, id, isPinned, labels, milestone, number, projectCards, projectItems, reactionGroups, state, stateReason, title, updatedAt, url`.

- ⚠️ `id` is the GraphQL **node_id** (`I_kwDORagw-c8AAAABLFDumA`), **not** the REST database id. `gh api` returns the integer database id (§5).
- `comments` is an array (`author`, `body`, `createdAt`, `url`, …). `milestone` is `null` or an object; `labels` is an array of `{name, color, ...}`.
- `gh search issues` fields differ: `assignees, author, authorAssociation, body, closedAt, commentsCount, createdAt, id, isLocked, isPullRequest, labels, number, repository, state, title, updatedAt, url`.
- `--jq` needs no local `jq` binary; built-in (verified `gh help formatting`).

```sh
# Filter + reshape (labels as names)
gh issue list --state all --json number,title,labels --jq \
  'map(select(.labels | any(.name == "wayfinder:map"))) | .[] | "\(.number): \(.title)"'
```

**Safe bulk scripting:** fetch numbers first, then loop — never interpolate bodies through the shell:

```sh
for n in $(gh issue list --state open --label wayfinder:task --json number --jq '.[].number'); do
  gh issue edit "$n" --add-label ready-for-agent
done
gh api 'repos/rajofearth/muxics/issues?state=all&per_page=100' --paginate --jq '.[].number'   # >30/100, paginated
```

Bulk edits are per-request; add `-R`/`--repo` everywhere to avoid acting on the wrong repo, and prefer `--body-file` over `--body` in loops.

## 5. The API escape hatch (`gh api`)

Manual: <https://cli.github.com/manual/gh_api>. `{owner}/{repo}` placeholders resolve from the local repo; use `--method`, `-X`, `-f key=value` (strings), `-F key=value` (typed), `--input file` (JSON body), `--paginate`, `--slurp`.

**Comments** (not fully covered by `gh issue comment`, which only edits/deletes **your last** comment) — <https://docs.github.com/en/rest/issues/comments>:

```sh
gh api "repos/rajofearth/muxics/issues/34/comments" --jq '.[] | {id, user: .user.login, created_at, body}'   # (verified: returns ids 5154969639, 5155090185)
gh api -X PATCH  -f body="New text"  "repos/rajofearth/muxics/issues/comments/{COMMENT_ID}"   # edit any comment
gh api -X DELETE "repos/rajofearth/muxics/issues/comments/{COMMENT_ID}"                       # delete any comment
```

**Native sub-issues — usable REST** (verified live on this repo; `GET …/issues/34/sub_issues` returned #35–#38) — <https://docs.github.com/en/rest/issues/sub-issues>:

```sh
gh api "repos/rajofearth/muxics/issues/34/sub_issues" --jq '.[] | {number, title, id}'      # list (verified)
gh api "repos/rajofearth/muxics/issues/38/parent" --jq '{number, title}'                     # parent (verified)
gh api "repos/rajofearth/muxics/issues/34/parent" 2>&1                                       # no parent → error
# add: needs the sub-issue's REST database id, NOT the gh --json id:
SUB_ID=$(gh api "repos/rajofearth/muxics/issues/38" --jq '.id')                              # e.g. 5038470230
gh api -X POST "repos/rajofearth/muxics/issues/34/sub_issues" -f sub_issue_id="$SUB_ID"
gh api -X DELETE "repos/rajofearth/muxics/issues/34/sub_issue" -f sub_issue_id="$SUB_ID"
gh api -X PATCH "repos/rajofearth/muxics/issues/34/sub_issues/priority" -f sub_issue_id="$SUB_ID" -f after_id=5038470229
```

**Issue dependencies (blocks / blocked-by)** — documented endpoints exist (<https://docs.github.com/en/rest/issues/issue-dependencies>): `GET …/issues/{n}/dependencies/blocked_by|blocking`, `POST …/dependencies/blocked_by -f issue_id=<id>`, `DELETE …/dependencies/blocked_by/{issue_id}`. On this account the **read** path responds (verified: `blocked_by` → `[]`), but the **write** path 404s (feature not enabled for the account) — treat deps as unavailable here; use sub-issues instead.

**Other gaps `gh issue` can't do:** create milestones and issue types (no `gh milestone` command in 2.87.3):

```sh
gh api -X POST "repos/rajofearth/muxics/milestones" -f title="1.0" -f description="..." -f due_on="2026-12-31T00:00:00Z"
gh api "repos/rajofearth/muxics/milestones" --jq '.[].title'
```

## 6. Labels, milestones, assignees

```sh
gh label list                                   # (verified: 15 labels incl. wayfinder:map, wayfinder:research, …)
gh label create "wayfinder:task" --description "…" --color 1D76DB     # idempotent-ish: --force to update existing
gh label edit "wayfinder:task" --description "…" --color 1D76DB
gh label delete "wayfinder:task" --yes
# apply/remove on issues
gh issue create --title "…" --label "wayfinder:research,ready-for-agent"
gh issue edit 38 --add-label "wayfinder:grilling" --remove-label "wayfinder:prototype"
# milestones (create via gh api §5; set here)
gh issue edit 38 --milestone "1.0";  gh issue edit 38 --remove-milestone
# assignees
gh issue create --title "…" --assignee "@me"
gh issue edit 38 --add-assignee rajofearth --remove-assignee someone
```

Labels by name with commas: `--label "a,b"` == `--label a --label b`. Assignees/milestones must exist in the repo; assignees need push access. Manuals: <https://cli.github.com/manual/gh_label_create>.

## 7. Auth & repo inference

- `gh auth status` — account + scopes. `gh auth refresh -s project` adds project scope if needed (`--project` flags).
- Tokens: `GH_TOKEN`, then `GITHUB_TOKEN` (precedence order), then stored creds — `gh help environment`. `GH_REPO=[HOST/]OWNER/REPO` overrides repo inference for a command.
- Repo inference: gh reads `git remote -v` in the clone (verified above). **This repo was renamed** `winamp-player → muxics`; gh still prints `rajofearth/winamp-player` in headers (e.g. `gh label list`) because it uses the remote URL. API/`gh` calls still resolve correctly (GitHub redirects), but for consistency: `gh repo set-default rajofearth/muxics` (or `-R rajofearth/muxics` per command). Manual: <https://cli.github.com/manual/gh_repo_set-default>.

## 8. Recommended workflow (map issue + sub-issues, per issue-tracker.md)

Pattern used by the live `wayfinder` effort — map issue #34 "Design the Muxics benchmark system" with sub-issues #35–#38 (`wayfinder:research|prototype|grilling|task`), map body updated as decisions lock, closed with a summary comment.

```sh
# 1. Map issue (with heredoc body)
gh issue create --title "Map: <effort>" --label wayfinder:map --body-file - <<'EOF'
## Goal
## Workstreams (ticket-per-decision; add via §5 sub-issues API)
## Definition of done
EOF

# 2. Sub-issues, one per phase — create, then attach to the map (gh 2.87.3 has no --add-sub-issue)
gh issue create --title "Research <topic>" --label wayfinder:research --body-file sub.md
SUB_ID=$(gh api repos/rajofearth/muxics/issues/<new-n> --jq .id)      # REST id, not --json id
gh api -X POST "repos/rajofearth/muxics/issues/<map-n>/sub_issues" -f sub_issue_id="$SUB_ID"
# 3. Link assets: reference docs/artifacts in a comment
gh issue comment <map-n> --body-file - <<'EOF'
Map progress update — decisions locked: …
Artifacts: docs/benchmarks/design.md, benchmarks/runs/
EOF
# 4. Update the map body as decisions lock (full rewrite; works on closed issues too)
gh issue edit <map-n> --body-file map.md
# 5. Close with a summary comment (per issue-tracker.md convention)
gh issue close <map-n> --reason completed --comment "All sub-issues resolved — see docs/… for the locked design."
# Watch the map's sub-issues
gh issue view <map-n> --json subIssues --jq '…' 2>/dev/null || gh api "repos/rajofearth/muxics/issues/<map-n>/sub_issues" --jq '.[] | "\(.number)\t\(.title)"'
```

Always: `--body-file` + quoted heredoc for anything with backticks/`$`/quotes; `-R rajofearth/muxics` (or `gh repo set-default`) after the rename; verify state/labels with `--json … --jq` before bulk operations.
