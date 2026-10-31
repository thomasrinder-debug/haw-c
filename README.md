# HAW Kiel C

C-Programme in VS Code übersetzen, starten und debuggen, ohne Einrichtung und ohne Administratorrechte. Für die Lehre an der HAW Kiel.

Autor: Prof. Dr.-Ing. Thomas Rinder, HAW Kiel, thomas.rinder@haw-kiel.de

Quelltext: https://github.com/thomasrinder-debug/haw-c

## Installation

Sie brauchen Windows 10 oder 11 (64 Bit), Internet für die Installation und rund 1 GB freien Speicherplatz. Administratorrechte sind nicht nötig. Auf verwalteten Rechnern siehe „Probleme“ unten.

1. **VS Code installieren:** Unter https://code.visualstudio.com/download bei Windows den **User Installer** (x64) laden und ausführen. Ist VS Code schon installiert, entfällt dieser Schritt. Es muss das VS Code von Microsoft sein, mit VSCodium läuft der Debugger nicht.
2. **Extension laden:** Unter https://github.com/thomasrinder-debug/haw-c/releases/latest die Datei `haw-c-win32-x64-….vsix` herunterladen.
3. **Extension installieren:** In VS Code links die Ansicht **Erweiterungen** öffnen (Strg+Umschalt+X), oben im Bereich auf **…** klicken, **Aus VSIX installieren …** wählen (englisch: *Install from VSIX…*) und die Datei auswählen. Die benötigte Microsoft-Extension C/C++ kommt automatisch mit.
4. **Fenster neu laden:** Strg+Umschalt+P drücken, **Developer: Reload Window** eingeben und bestätigen.
5. **Testen:** Über **Datei → Ordner öffnen** einen Ordner wählen und darin eine Datei `hallo.c` anlegen:

   ```c
   #include <stdio.h>

   int main(void)
   {
       printf("Hallo Welt\n");
       return 0;
   }
   ```

   Beim ersten Öffnen erscheint unten rechts „HAW Kiel C wird einmalig eingerichtet …“. Warten Sie, bis die Meldung verschwindet, das dauert meist unter einer Minute. Klicken Sie dann oben rechts auf **▶**. Im Terminal steht „Hallo Welt“ und darunter „Programm beendet.“

Fertig. Ein eigener Compiler ist nicht nötig, ein schon installierter bleibt unberührt.

### Probleme

| Was passiert | Was zu tun ist |
|---|---|
| „Windows lässt … nicht starten“ oder „durch eine Richtlinie blockiert“ | Der Rechner ist verwaltet oder ein Virenscanner greift ein. Die IT muss Programme im Ordner `%APPDATA%\Code\User\globalStorage\thomasrinder.haw-c` und im Projektordner freigeben. |
| Die Extension C/C++ lässt sich nicht installieren | Internet oder Proxy prüfen, dann in den Erweiterungen nach `ms-vscode.cpptools` suchen und sie von Hand installieren. |
| Der Knopf ▶ fehlt | Ist eine `.c`-Datei geöffnet? Sonst das Fenster neu laden. |
| Im Menü **Ausführen** erscheint eine Debugger-Auswahl | Abbrechen und einmal eine `.c`-Datei öffnen. Danach geht es auch über dieses Menü. |
| Debuggen in einem Ordner mit Umlauten scheitert | Das Projekt in einen Ordner ohne Umlaute legen. |
| Etwas anderes | Im Menü **HAW Kiel C** (Statusleiste unten links) erst „Umgebung neu aufsetzen“ versuchen, Ihre Quelltexte bleiben dabei erhalten. Hilft das nicht, „Diagnose kopieren“ wählen und den Text der Lehrkraft schicken. Er enthält Ihren Benutzernamen nicht. |

### Aktualisieren und entfernen

**Aktualisieren:** Neue VSIX-Datei laden und wie in Schritt 3 installieren, dann das Fenster neu laden. Bei einer Installation aus einer Datei kommen Updates nicht von selbst.

**Entfernen:** In den Erweiterungen bei HAW Kiel C auf **Deinstallieren** klicken. Danach bleiben zwei Reste, die Sie von Hand löschen können: der Ordner `%APPDATA%\Code\User\globalStorage\thomasrinder.haw-c` (rund 600 MB) und in den Einstellungen unter `launch` der Eintrag „HAW Kiel C“. Die Microsoft-Extension C/C++ entfernen Sie getrennt, falls Sie sie nicht mehr brauchen.

## Bedienung

1. Eine `.c`-Datei öffnen. Beim ersten Mal richtet sich die Umgebung von selbst ein.
2. Oben rechts im Editor stehen **Ausführen** (Strg+F5) und **Debuggen** (F5).
3. Das Menü „HAW Kiel C“ in der Statusleiste enthält Make-Ziele, Programmargumente, „Nur aktive Datei übersetzen“, Übersetzungsschritte, Neues Projekt, Terminal, Diagnose und „Umgebung neu aufsetzen“.

## Projekte mit mehreren Dateien

Mehrere `.c`-Dateien und eigene Header-Dateien gehen ohne Einstellung und ohne Makefile. Gestartet werden kann aus jeder Datei des Projekts, auch aus einem Header.

Binden Sie eigene Header in Anführungszeichen ein: `#include "rechnen.h"`.

Zwei Aufteilungen werden erkannt:

```text
programm/               programm/
  main.c                  src/
  rechnen.c                 main.c
  rechnen.h                 rechnen.c
                          include/
                            rechnen.h
```

Auch `.c`-Dateien in `lib/` gehören dazu. Weiter unten liegende Ordner werden nicht durchsucht, dafür braucht es ein Makefile.

Welche Dateien zusammen übersetzt werden, entscheidet die Funktion `main`:

| Im Ordner | Was übersetzt wird |
|---|---|
| ein `main` | alle `.c`-Dateien des Ordners |
| mehrere `main`, etwa Übungsaufgaben | die aktive Datei und alle `.c`-Dateien ohne `main` |
| mehrere `main`, aktive Datei ohne `main` | nichts; eine Meldung nennt die Dateien mit `main`, eine davon öffnen |

Das Programm startet im Projektordner, relative Dateinamen in `fopen` beziehen sich also darauf. Bei der Aufteilung mit `src/` ist das der Ordner darüber.

Gehört eine `.c`-Datei im Ordner nicht zum Programm, verschieben Sie sie in einen eigenen Ordner oder schalten im Menü „Nur aktive Datei übersetzen“ ein.

## Projekte mit Makefile

Liegt ein Makefile im Ordner der Datei oder darüber, baut immer `make`, und die Regeln oben gelten nicht. Flags, Dateien und Ablageort bestimmt dann allein das Makefile. Vorlagen dazu gibt es unter „Neues Projekt“, auch mit eigener Bibliothek als `.a` oder `.dll`.

▶ startet das Ziel `run`, falls es eines gibt, sonst das gebaute Programm. Debuggen startet immer das gebaute Programm, dazu muss das Makefile mit `-g` übersetzen.

## Aufgaben mit Selbsttest

Liegt im Projektordner eine Datei `aufgabe.json`, erscheint oben rechts der Knopf **Aufgabe prüfen**. Er übersetzt das Programm, startet es für jeden Test mit der vorgegebenen Eingabe und zeigt im Ausgabefenster „HAW Kiel C: Aufgabe“, welche Tests bestehen und wo die Ausgabe abweicht. Es wird nichts übertragen, alles läuft auf dem eigenen Rechner.

Eine Vorlage liegt unter „Neues Projekt“ → „Aufgabe mit Selbsttest“.

```json
{
  "name": "Summe zweier Zahlen",
  "timeout_sec": 2,
  "vergleich": "letzteZahl",
  "tests": [
    { "name": "Positive Zahlen", "input": "3\n4\n", "erwartet": "7" },
    { "name": "Mit negativer Zahl", "input": "5\n-8\n", "erwartet": "-3" }
  ]
}
```

| Feld | Bedeutung | Vorgabe |
|---|---|---|
| `tests` | Liste der Tests mit `erwartet`, dazu optional `name` und `input` (Tastatureingabe) | Pflicht |
| `vergleich` | `letzteZahl`: letzte Zahl der Ausgabe; `zahlen`: alle Zahlen in gleicher Anzahl; `text`: genauer Wortlaut ohne Leerzeichen am Zeilenende | `letzteZahl` |
| `toleranz` | erlaubte absolute Abweichung bei Zahlen | 0,2 absolut oder 5 % relativ |
| `timeout_sec` | Zeitlimit je Test in Sekunden | 2 |

Bewertet wird nur die Standardausgabe. Zahlen müssen mit Dezimalpunkt erscheinen, bei `3,5` zählt nur die `5`. Der Rückgabewert von `main` zählt nicht, ein Absturz oder ein überschrittenes Zeitlimit schon.

Der Selbsttest ist eine Übungshilfe und keine Prüfung: Die erwarteten Ergebnisse stehen lesbar in der Datei.

## Speicherprüfung

Ohne Makefile läuft die Speicherprüfung immer mit. Sie meldet im Terminal und im Problemfenster mit Datei und Zeile:

| Meldung | Bedeutung | Gemeldete Zeile |
|---|---|---|
| Speicherleck | Block nie freigegeben | `malloc` |
| Doppeltes `free` | Block schon freigegeben | zweites `free` |
| `free` auf fremden Zeiger | Zeiger stammt nicht von `malloc` | `free` |
| Über die Grenzen geschrieben | über den Anfang oder das Ende des Blocks hinaus | `malloc` des Blocks |
| Nach `free` geschrieben | in einen schon freigegebenen Block | `free` |

Die Meldungen erscheinen beim Programmende. Stürzt das Programm ab, gibt es keine Meldungen. Neu angeforderter Speicher ist mit `0xCD` gefüllt, freigegebener mit `0xDD`, damit das Lesen solcher Werte beim Debuggen auffällt.

Grenzen: Ein Lesezugriff außerhalb eines Blocks wird nicht erkannt, ein Schreibzugriff nur im Abstand von bis zu 16 Bytes hinter dem Block. Das gilt nicht für Felder auf dem Stack; bei Feldern mit bekannter Größe greift stattdessen die Prüfung auf undefiniertes Verhalten. Speicher aus Bibliotheksfunktionen wie `_strdup` wird nicht geprüft. Programme mit Threads werden nicht unterstützt.

Abschalten lässt sie sich mit der Einstellung `hawC.speicherpruefung`. In Makefile-Projekten bestimmt das Makefile die Flags, die Prüfung läuft deshalb nur auf Wunsch: Menü → „Mit Speicherprüfung neu bauen und starten“. Danach bleibt sie eingebaut, bis `make` die Dateien neu übersetzt, zum Beispiel nach `make clean`.

## Übersetzungsschritte

Menü → **Übersetzungsschritte anzeigen** führt die vier Stufen von `gcc` einzeln aus und zeigt die Befehle dazu: Präprozessor (`.i`), Compiler (`.s`), Assembler (`.o`, mit den Namen, die die Datei anbietet und noch braucht) und Linker. Die Zwischenergebnisse lassen sich öffnen und landen nicht im Projektordner. Bei einem Fehler endet die Übersicht an der Stufe, die fehlschlägt.

Bei Makefile-Projekten zeigt der Befehl die Aufrufe aus `make -n`. Der genaue Befehl jedes normalen Baus steht außerdem im Ausgabefenster „HAW Kiel C“.

## Technik

Debugger und Editorhilfe nutzen die Microsoft-Extension C/C++, die mitinstalliert wird. Alle übrigen Werkzeuge stammen aus w64devkit.

## w64devkit

Diese Extension beruht auf w64devkit von Christopher Wellons (skeeto). Es ist kein Teil der HAW Kiel und wird dort nicht entwickelt.

| Angabe | Wert |
|---|---|
| Projekt | https://github.com/skeeto/w64devkit |
| Fassung | 2.11.0, x64 |
| Datei | `w64devkit-x64-2.11.0.7z.exe` |
| Quelle | https://github.com/skeeto/w64devkit/releases/download/v2.11.0/w64devkit-x64-2.11.0.7z.exe |
| SHA-256 | `54c2bb9962e8a30c8270e34c5efc3d5fee579f53087fa7d435b95fbba2af7b2b` |
| Lizenz | Unlicense; zur Laufzeit von Mingw-w64 und GCC siehe `COPYING.MinGW-w64-runtime.txt` im Kit |
| Release | https://github.com/skeeto/w64devkit/releases/tag/v2.11.0 |
| Quelltext aller Werkzeuge | https://github.com/skeeto/w64devkit/releases/download/v2.11.0/source.tar |
| SHA-256 des Quelltexts | `50ee43ca02b9ca49e0e16da7eaf9701c9a396a019ebb2416a93d16769d53e5ff` |

Die Werkzeuge im Kit stehen unter eigenen Lizenzen, GCC, GDB und GNU Make etwa unter der GPL. Die Quellen der wichtigsten Werkzeuge in genau den enthaltenen Fassungen:

| Werkzeug | Fassung | Quelle |
|---|---|---|
| GCC | 16.2.0 | https://ftp.gnu.org/gnu/gcc/gcc-16.2.0/gcc-16.2.0.tar.xz |
| GNU Binutils (`ld`, `nm`, `objdump`, `addr2line`) | 2.47 | https://ftp.gnu.org/gnu/binutils/binutils-2.47.tar.xz |
| GDB | 18.1 | https://ftp.gnu.org/gnu/gdb/gdb-18.1.tar.xz |
| GNU Make | 4.4.1 | https://ftp.gnu.org/gnu/make/make-4.4.1.tar.gz |
| Mingw-w64 | 14.0.0 | https://downloads.sourceforge.net/project/mingw-w64/mingw-w64/mingw-w64-release/mingw-w64-v14.0.0.tar.bz2 |
| busybox-w32 | FRP-6354-g5f09fb446 | https://github.com/rmyorston/busybox-w32/archive/refs/tags/FRP-6354-g5f09fb446.tar.gz |

Die übrigen Werkzeuge, etwa CMake, Ninja und Vim, stehen mit ihrem Quelltext in `source.tar`. Die Microsoft-Extension C/C++ liegt nicht im Paket: https://github.com/microsoft/vscode-cpptools

Genutzt werden daraus GCC, GDB, GNU Make, `make2compdb`, `objdump`, `nm`, `addr2line` und `sh` aus busybox-w32.

Die Datei liegt unverändert im Paket. Beim ersten Einsatz wird sie nach `%APPDATA%\Code\User\globalStorage\thomasrinder.haw-c\w64devkit-2.11.0` entpackt. Danach löscht die Extension dort den Ordner `lib32`, weil 32-Bit-Programme nicht vorgesehen sind. Sonst wird am Kit nichts geändert.

Daraus folgen auch die Grenzen: Es entstehen Windows-Programme (Laufzeit MSVCRT), AddressSanitizer und valgrind gibt es nicht. Die Speicherprüfung oben ist deshalb eine eigene, einfachere Lösung dieser Extension.

## Entwicklung

`npm install`, dann `npm run paket` für das VSIX und `npm test` für die Tests im eigenen VS Code.

## Lizenz und Entstehung

Die Extension darf für Studium, Lehre, Prüfungen, persönliches Lernen und nicht kommerzielle Forschung kostenlos genutzt, verändert und weitergegeben werden. Der Einsatz in Unternehmen und jede andere Nutzung zu Erwerbszwecken bedürfen der schriftlichen Zustimmung des Urhebers. Maßgeblich ist der vollständige Text in `LICENSE.txt`. Für w64devkit und die Microsoft-Extension C/C++ gelten deren eigene Lizenzen.

Die Extension wurde mit Unterstützung der KI Claude Opus 5.5 von Anthropic erstellt und vom Urheber angeleitet und geprüft.