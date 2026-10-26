# usage-band

A Claude Code mod that draws a band above the prompt: the context window fill as a full-width bar, and the Session (5hr) and Weekly (7 day) rate limits side by side, each coloured green, yellow (60%+) or red (85%+).

## Install

At the prompt of a terminal session:

```
/plugin install usage-band --marketplace AleixFerreCP/usage-band-claude-mod
```

From a shell:

```
claude plugin install usage-band --marketplace AleixFerreCP/usage-band-claude-mod
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `AleixFerreCP/usage-band-claude-mod`, then Add plugin.

This repository is private: the install works only for GitHub accounts that can read it, on a machine that already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).
