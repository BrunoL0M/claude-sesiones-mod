# Sesion · mod para Claude Code

Panel dentro de Claude Code (terminal) con **todas las sesiones locales** de este
equipo, leídas de `~/.claude/projects` (o `$CLAUDE_CONFIG_DIR/projects`):

1. **Por directorio**: cada carpeta donde se inició un chat, la más reciente arriba
   (el directorio actual viene desplegado).
2. **Por fecha** dentro de cada directorio: Hoy · Ayer · Últimos 7 días · Últimos 30 días.
3. **Chats antiguos (más de 1 mes)**: plegados al final de cada directorio.

Al pulsar una sesión se ven sus mensajes, rama de git, id y dos botones:
**Reanudar** (ejecuta `/resume <id>`) y **Copiar comando**
(`cd '<dir>' && claude --resume <id>`). Arriba hay un campo para filtrar por
título o ruta, y `⟳` (tecla `r` con el panel enfocado) vuelve a escanear.

## Uso

```
/sesiones             abre el panel (escanea la primera vez)
/sesiones actualizar  vuelve a escanear
```

El panel se acopla al lado del chat con la terminal en pantalla completa y al
menos 110 columnas; más estrecha aparece encima del prompt. `ctrl+x tab` le da
el foco, Tab recorre los botones, Enter pulsa, Esc vuelve al prompt.

## Instalación (Arch Linux)

Requiere una versión de Claude Code con mods de "function hooks" (probado con 2.1.296).

```bash
mkdir -p ~/.claude/mods
cp -r sesiones ~/.claude/mods/
claude plugin marketplace add ~/.claude/mods/sesiones
claude plugin install sesiones@sesiones-local
```

Para probarlo sin instalar: `claude --plugin-dir ~/.claude/mods/sesiones`.

## Cómo decide cada dato

- **Directorio**: el campo `cwd` del transcript (el nombre de la carpeta en
  `projects/` es ambiguo con guiones, solo se usa si falta `cwd`).
- **Fecha**: la última modificación del `.jsonl`, es decir, la última actividad.
- **Título**: título personalizado > título automático > resumen > primer prompt.
- Las sesiones sin ningún prompt se omiten. Los datos se cachean por tamaño y
  fecha del archivo, así que reescanear es rápido.

## Desarrollo

```bash
claude plugin validate .
claude plugin test .
```
