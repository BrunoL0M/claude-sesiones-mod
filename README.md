# Sesiones · mod para Claude Code

**Español** · [English](README.en.md)

Un panel dentro de Claude Code (en la terminal) con **todos los chats locales de
este equipo**, como la lista de sesiones de la versión web: agrupados por la
carpeta donde empezaron, luego por fecha, y con los de más de un mes aparte en
**Chats antiguos**.

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

<sub>Ilustración aproximada; los colores y el ancho dependen de tu terminal.</sub>

## Instalación

Requiere Claude Code con soporte de mods ("function hooks"). Está probado con
las versiones 2.1.296 y 2.1.301.

```bash
claude plugin marketplace add BrunoL0M/claude-sesiones-mod
claude plugin install sesiones@sesiones-local
```

Reinicia Claude Code y escribe `/sesiones`.

### Actualizar

```bash
claude plugin marketplace update sesiones-local
claude plugin update sesiones@sesiones-local
```

Claude Code solo instala una versión nueva cuando cambia `version` en
[`.claude-plugin/plugin.json`](.claude-plugin/plugin.json). Si un cambio llega a
`main` sin subir la versión, `update` no lo descarga.

### Probar una rama o cambios locales

Instalado desde GitHub, Claude Code usa una copia de `main` guardada en
`~/.claude/plugins/cache/`, así que cambiar de rama en un clon no tiene efecto.
Para probar una rama, apunta el marketplace a tu clon:

```bash
git clone https://github.com/BrunoL0M/claude-sesiones-mod ~/.claude/mods/sesiones
git -C ~/.claude/mods/sesiones switch <rama>

claude plugin marketplace remove sesiones-local
claude plugin marketplace add ~/.claude/mods/sesiones
claude plugin install sesiones@sesiones-local
```

Con un marketplace local, `claude plugin list` muestra "Read from: <carpeta>" y
los cambios se cargan al reiniciar Claude Code. Para volver a la versión
publicada, repite `remove` y añade otra vez `BrunoL0M/claude-sesiones-mod`.

Para una prueba rápida sin instalar nada: `claude --plugin-dir ~/.claude/mods/sesiones`.

## Uso

| Comando | Qué hace |
| --- | --- |
| `/sesiones` | Abre el panel. La primera vez escanea los chats. |
| `/sesiones actualizar` | Abre el panel y vuelve a escanear (también vale `refresh` o `r`). |

Con la terminal ancha (unas 110 columnas o más) el panel se acopla al lado del
chat; más estrecha, aparece encima del prompt.

| Tecla | Acción |
| --- | --- |
| `ctrl+x tab` | Lleva el foco al panel |
| `Tab` | Pasa de un botón al siguiente |
| `Enter` | Pulsa el botón o abre la carpeta o el chat |
| `r` | Vuelve a escanear (con el panel enfocado) |
| `Esc` | Vuelve al prompt |

### Qué muestra

- **Carpetas.** Cada carpeta donde se inició algún chat. La carpeta actual va
  primero, marcada con `●` y desplegada. Las demás salen plegadas en una línea
  con su número de chats y la última actividad.
- **Fechas.** Dentro de cada carpeta: Hoy, Ayer, Últimos 7 días y Últimos 30
  días, con la hora o la fecha a la derecha. Cada bloque enseña 5 chats y un
  "…y N más" para ver el resto.
- **Chats antiguos (más de 1 mes).** Plegados al final de cada carpeta.
- **Filtro.** El campo de arriba busca por título o ruta y despliega todo lo que
  coincide.
- Si dos chats se llaman igual, se añade el principio de su id para
  distinguirlos.

### Acciones de un chat

Al pulsar un chat se ven sus mensajes, la rama de git, cuándo empezó y estos
botones:

| Botón | Qué hace |
| --- | --- |
| **Reanudar** | Ejecuta `/resume <id>` en la sesión actual. |
| **Abrir en terminal** | Solo en chats de otra carpeta. Abre una terminal nueva en esa carpeta con `claude --resume <id>`. |
| **Renombrar** | Abre un campo con el título actual. Enter guarda; vacío cancela. |
| **Copiar comando** | Copia `cd '<carpeta>' && claude --resume <id>`. |

**Chats de otra carpeta.** Claude Code solo reanuda dentro de la sesión los
chats de su misma carpeta; con los de otra, Reanudar solo te enseña el comando.
Por eso aparece **Abrir en terminal**, que usa `xdg-terminal-exec` (la que trae
Omarchy) o, si no existe, `$TERMINAL -e`. Si no encuentra ninguna o la carpeta
ya no existe, copia el comando para que lo pegues a mano.

**Renombrar** añade al `.jsonl` la misma línea que escribe `/rename`, así que el
título nuevo también sale en `claude --resume`. No cambia la fecha del chat, así
que no salta a "Hoy" ni sale de "Chats antiguos". Ojo: si ese chat está abierto
en otra terminal y ya tenía un título puesto con `/rename`, esa sesión puede
volver a escribir el suyo al cerrarse.

## Cómo decide cada dato

Lee los transcripts `*.jsonl` de `~/.claude/projects` (o
`$CLAUDE_CONFIG_DIR/projects` si está definida).

- **Carpeta.** El campo `cwd` del transcript. El nombre de la carpeta dentro de
  `projects/` solo se usa si falta, porque es ambiguo con guiones.
- **Fecha.** La última modificación del `.jsonl`, es decir, la última actividad.
  Hoy, Ayer y 7 días se cortan a medianoche local; "antiguo" es más de 30 días.
- **Título.** Título puesto con `/rename` > título automático > resumen > primer
  mensaje.
- Los avisos que Claude Code guarda como mensajes del usuario
  (`[Request interrupted by user…]`) no cuentan como mensaje ni como título.
- Los chats sin ningún mensaje se omiten.
- Los datos se guardan en caché por tamaño y fecha de cada archivo, así que
  reescanear es rápido. De los transcripts de más de 4 MB solo se lee el
  principio y el final.

## Problemas frecuentes

- **No veo los botones nuevos tras actualizar.** Revisa de dónde instala el
  marketplace con `claude plugin list`, y que la versión de `plugin.json` haya
  subido (ver [Actualizar](#actualizar)).
- **"No encuentro la carpeta de sesiones".** No existe `~/.claude/projects` (o
  `$CLAUDE_CONFIG_DIR/projects`). Pasa si nunca has abierto un chat con esa
  configuración.
- **Abrir en terminal no hace nada.** Instala `xdg-terminal-exec` o define
  `TERMINAL` (por ejemplo `export TERMINAL=alacritty`). Mientras tanto, usa
  Copiar comando.
- **"ensancha la terminal para ver el panel".** No hay sitio para el panel;
  amplía la ventana o reduce la fuente.

## Desarrollo

```
.claude-plugin/   plugin.json (versión) y marketplace.json
hooks/
  register.tsx    comando /sesiones, escaneo y panel
  sessions.ts     lógica pura: leer transcripts, agrupar, fechas, comandos
types/            tipos del estado del panel
tests/            pruebas con `claude plugin test`
```

```bash
claude plugin validate .   # comprueba el manifiesto y los hooks
claude plugin test .       # ejecuta las pruebas de tests/
```

Si un cambio afecta al mod (no solo a la documentación), sube `version` en
`.claude-plugin/plugin.json` para que llegue con `claude plugin update`.

Si cambias este README, actualiza también [README.en.md](README.en.md) (inglés).
