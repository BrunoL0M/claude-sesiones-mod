# Sesion · mod para Claude Code

Panel dentro de Claude Code (terminal) con **todas las sesiones locales** de este
equipo, leídas de `~/.claude/projects` (o `$CLAUDE_CONFIG_DIR/projects`):

1. **Por directorio**: cada carpeta donde se inició un chat. La carpeta actual va
   primero, marcada con `●` y desplegada; las demás aparecen plegadas en una línea
   con su número de sesiones y la última actividad.
2. **Por fecha** dentro de cada directorio: Hoy · Ayer · Últimos 7 días · Últimos 30 días,
   con la hora o la fecha alineada a la derecha. Cada bloque enseña 5 sesiones y un
   "…y N más" para ver el resto.
3. **Chats antiguos (más de 1 mes)**: plegados al final de cada directorio.

Al pulsar una sesión se ven sus mensajes, rama de git, cuándo empezó y dos botones:
**Reanudar** (ejecuta `/resume <id>`) y **Copiar comando**
(`cd '<dir>' && claude --resume <id>`). Claude Code solo reanuda dentro de la
sesión los chats de la misma carpeta, así que en los de otra carpeta se añade
**Abrir en terminal** junto a Reanudar (que allí solo muestra el comando): abre una terminal nueva (`xdg-terminal-exec`, la de
Omarchy, o `$TERMINAL -e`) en esa carpeta con `claude --resume <id>`. Si no
puede, copia el comando.

**Renombrar** abre un campo con el título actual; Enter guarda y un título vacío
cancela. Escribe en el `.jsonl` la misma línea que `/rename`, así que el nuevo
título también sale en `claude --resume`, y no cambia la fecha del chat (no salta
a "Hoy"). Si ese chat está abierto en otra terminal y ya tenía un título puesto
con `/rename`, esa sesión puede volver a escribir el suyo al cerrarse. Arriba hay un campo para filtrar por
título o ruta (despliega todo lo que coincide), y `⟳` (tecla `r` con el panel
enfocado) vuelve a escanear. Si dos sesiones se llaman igual, se añade el principio
de su id para distinguirlas.

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
- Los avisos que Claude Code guarda como mensajes del usuario
  (`[Request interrupted by user…]`) no cuentan como prompt ni como título.
- Las sesiones sin ningún prompt se omiten. Los datos se cachean por tamaño y
  fecha del archivo, así que reescanear es rápido.

## Desarrollo

```bash
claude plugin validate .
claude plugin test .
```
