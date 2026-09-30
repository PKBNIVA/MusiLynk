#!/usr/bin/env bash
# Owner-approved: add git.deploymentEnabled {claude/*: false, claude/**: false} to vercel.json on claude/launch-2 and push.
set -euo pipefail
REPO=/home/user/verse-music-platform
WT=/home/user/wt-launch2
cd "$REPO" && git fetch -q origin claude/launch-2
[ -d "$WT" ] || git worktree add -q "$WT" -B claude/launch-2 origin/claude/launch-2
cd "$WT" && git checkout -q claude/launch-2 && git merge -q --ff-only origin/claude/launch-2
python3 - <<'PY'
import json, collections
p = 'vercel.json'
data = json.loads(open(p).read(), object_pairs_hook=collections.OrderedDict)
if 'git' not in data:
    new = collections.OrderedDict()
    for k, v in data.items():
        new[k] = v
        if k == 'outputDirectory':
            new['git'] = collections.OrderedDict([("deploymentEnabled", collections.OrderedDict([("claude/*", False), ("claude/**", False)]))])
    data = new
    open(p, 'w').write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print("git:", json.dumps(data['git']))
PY
npx prettier --write vercel.json >/dev/null && npx prettier --check vercel.json
if git diff --quiet -- vercel.json; then echo "vercel.json already has the rule"; exit 0; fi
git add vercel.json
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -F - <<'MSG'
Vercel: no automatic deployments for claude/* branches

Every push to a claude/* branch made Vercel create two deployments
(public and admin) even though the ignore step skipped their builds;
112 in 24 hours exhausted the free plan's daily limit and would have
refused the next production deploy. Branches matching claude/* and
claude/** no longer trigger deployments; production is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKVZ7DtE1jj6YgPmVPkvpk
MSG
for i in 1 2 3 4 5; do git push -u origin claude/launch-2 && break || sleep $((2**i)); done
git log --oneline -1
