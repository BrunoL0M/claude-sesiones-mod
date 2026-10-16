# Sesiones · a mod for Claude Code

[Español](README.md) · **English**

A panel inside Claude Code (in the terminal) with **every local chat on this
computer**, like the session list in the web version: grouped by the folder
where they started, then by date, with chats older than a month set apart under
**Chats antiguos** (old chats).

The panel's interface is in Spanish; this page translates each label the first
time it appears.

```
Sesiones · 42 en 5 carpetas                    r: ⟳
Filtrar: título o carpeta
─────────────────────────────────────────────────
▾ ~/.claude/mods/sesiones ●                     12
  HOY                                            2
    Mejorar el README                        00:26
  ❯ Arreglar el filtro con ~                 00:05
      14 mensajes · rama main · empezó 00:01
      [Reanudar] [Renombrar] [Copiar comando]
  ÚLTIMOS 7 DÍAS                                 4
    …
  ▸ Chats antiguos (más de 1 mes)                6
▸ ~/Obsidian/…/Redes                     8   ayer
▸ ~/proyectos/api                       22  09/2025
```

<sub>Approximate illustration; colours and width depend on your terminal.</sub>

## Installation

Requires a Claude Code version with mod support ("function hooks"). Tested
with versions 2.1.296 and 2.1.301.

```bash
claude plugin marketplace add BrunoL0M/claude-sesiones-mod
claude plugin install sesiones@sesiones-local
```

Restart Claude Code and type `/sesiones`.

### Updating

```bash
claude plugin marketplace update sesiones-local
claude plugin update sesiones@sesiones-local
```

Claude Code only installs a new version when `version` changes in
[`.claude-plugin/plugin.json`](.claude-plugin/plugin.json). If a change lands
on `main` without a version bump, `update` won't download it.

### Testing a branch or local changes

When installed from GitHub, Claude Code uses a copy of `main` stored in
`~/.claude/plugins/cache/`, so switching branches in a clone has no effect. To
test a branch, point the marketplace at your clone:

```bash
git clone https://github.com/BrunoL0M/claude-sesiones-mod ~/.claude/mods/sesiones
git -C ~/.claude/mods/sesiones switch <branch>

claude plugin marketplace remove sesiones-local
claude plugin marketplace add ~/.claude/mods/sesiones
claude plugin install sesiones@sesiones-local
```

With a local marketplace, `claude plugin list` shows "Read from: <folder>" and
changes load when you restart Claude Code. To go back to the published version,
run `remove` again and re-add `BrunoL0M/claude-sesiones-mod`.

For a quick try without installing anything: `claude --plugin-dir ~/.claude/mods/sesiones`.

## Usage

| Command | What it does |
| --- | --- |
| `/sesiones` | Opens the panel. Scans chats the first time. |
| `/sesiones actualizar` | Opens the panel and rescans (`refresh` or `r` also work). |

With a wide terminal (about 110 columns or more) the panel docks beside the
chat; narrower, it appears above the prompt.

| Key | Action |
| --- | --- |
| `ctrl+x tab` | Moves focus to the panel |
| `Tab` | Moves to the next button |
| `Enter` | Presses the button, or opens the folder or chat |
| `r` | Rescans (with the panel focused) |
| `Esc` | Returns to the prompt |

### What it shows

- **Folders.** Every folder where a chat was started. The current folder comes
  first, marked with `●` and expanded. The others are collapsed to one line with
  their chat count and last activity.
- **Dates.** Inside each folder: Hoy (today), Ayer (yesterday), Últimos 7 días
  (last 7 days) and Últimos 30 días (last 30 days), with the time or date on the
  right. Each block shows 5 chats and a "…y N más" (…and N more) to see the rest.
- **Chats antiguos (más de 1 mes)** (old chats, over 1 month). Collapsed at the
  end of each folder.
- **Filter.** The field at the top (Filtrar) searches by title or path and
  expands everything that matches.
- If two chats share a name, the start of their id is added to tell them apart.

### Chat actions

Selecting a chat shows its message count, git branch, when it started, and
these buttons:

| Button | What it does |
| --- | --- |
| **Reanudar** (resume) | Runs `/resume <id>` in the current session. |
| **Abrir en terminal** (open in terminal) | Only for chats from another folder. Opens a new terminal in that folder with `claude --resume <id>`. |
| **Renombrar** (rename) | Opens a field with the current title. Enter saves; empty cancels. |
| **Copiar comando** (copy command) | Copies `cd '<folder>' && claude --resume <id>`. |

**Chats from another folder.** Claude Code only resumes chats from the same
folder inside the session; for others, Reanudar only shows you the command.
That's why **Abrir en terminal** appears. It uses `xdg-terminal-exec` (the one
Omarchy ships) or, if missing, `$TERMINAL -e`. If it finds neither, or the
folder no longer exists, it copies the command so you can paste it yourself.

**Renombrar** appends to the `.jsonl` the same line `/rename` writes, so the new
title also shows in `claude --resume`. It doesn't change the chat's date, so it
won't jump to Hoy or leave Chats antiguos. Note: if that chat is open in
another terminal and already had a title set with `/rename`, that session may
write its own title back when it closes.

## How each value is decided

It reads the `*.jsonl` transcripts in `~/.claude/projects` (or
`$CLAUDE_CONFIG_DIR/projects` if set).

- **Folder.** The transcript's `cwd` field. The folder name inside `projects/`
  is only used if it's missing, because it's ambiguous with dashes.
- **Date.** The `.jsonl`'s last modification, i.e. the last activity. Today,
  yesterday and 7 days cut at local midnight; "old" means more than 30 days.
- **Title.** Title set with `/rename` > automatic title > summary > first
  message.
- Notices Claude Code stores as user messages
  (`[Request interrupted by user…]`) don't count as a message or title.
- Chats with no messages are skipped.
- Data is cached by each file's size and date, so rescanning is fast. For
  transcripts over 4 MB only the beginning and end are read.

## Troubleshooting

- **I don't see the new buttons after updating.** Check where the marketplace
  installs from with `claude plugin list`, and that the version in
  `plugin.json` went up (see [Updating](#updating)).
- **"No encuentro la carpeta de sesiones"** (can't find the sessions folder).
  `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) doesn't exist. This
  happens if you've never opened a chat with that configuration.
- **Abrir en terminal does nothing.** Install `xdg-terminal-exec` or set
  `TERMINAL` (for example `export TERMINAL=alacritty`). Meanwhile, use Copiar
  comando.
- **"ensancha la terminal para ver el panel"** (widen the terminal to see the
  panel). There's no room for the panel; enlarge the window or shrink the font.

## Development

```
.claude-plugin/   plugin.json (version) and marketplace.json
hooks/
  register.tsx    /sesiones command, scanning and panel
  sessions.ts     pure logic: read transcripts, grouping, dates, commands
types/            panel state types
tests/            tests run with `claude plugin test`
```

```bash
claude plugin validate .   # checks the manifest and hooks
claude plugin test .       # runs the tests in tests/
```

If a change affects the mod (not just the docs), bump `version` in
`.claude-plugin/plugin.json` so it arrives via `claude plugin update`.

Keep [README.md](README.md) (Spanish) and this file in sync when either changes.
