<!--
Title: the same form as a commit, `<type>(<scope>): <title>` or `<type>: <title>` as AGENTS.md
says. Lowercase, imperative, no trailing period, under 70 characters: it completes "If applied,
this change will ...".

Body: write for a reviewer who has not read the Issue. Delete every one of these comments, and
every optional part you do not use, so the pull request shows only what has content.
-->

<!--
Required, no heading, up to about 700 characters: the problem (what was wrong or missing, and for
whom) and what this pull request makes true. A reader who never opens the Issue should understand
both. Keep this paragraph always.
-->

<!--
Optional, up to about 700 characters, no heading: the decisions the code does not show. An
approach chosen over another and why, a case left out on purpose, a constraint that shaped the
solution. Keep it when there is such a decision; delete this paragraph otherwise.
-->

## Commits

<!--
Keep this section for two or more commits; delete the heading and this comment for a single
commit. One line per commit: `<short sha> <title>: what to look at in it`.
-->

## Not covered by CI

<!--
Keep this section when the Issue has criteria verified by use or by analysis; delete the heading
and this comment otherwise. One entry per such criterion: what was done (the accounts, App and
origin used, the command run and its output, or the argument made) and how a reviewer re-checks
it. An unverified point that is not a criterion belongs in Risk, not here.
-->

## Risk

<!--
Keep this section when any of the following is true; delete the heading and this comment when
none is. Up to six entries, each specific: a changed default or any behaviour an existing user or
builder gets without asking for it (even when it was decided on purpose), a renamed or removed
public name, an added parameter on an exported function, a wire or storage change, a deploy or
release order, and what is still unverified (for example, tested against fakes only).
-->

Fixes FLU-N
