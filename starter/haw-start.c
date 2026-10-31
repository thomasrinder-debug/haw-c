// Starter für Programme im Terminal: stellt die Konsole auf UTF-8, unterdrückt
// den Windows-Absturzdialog, startet das Programm und meldet, wie es endete.
// Aufruf: haw-start.exe <programm> [argumente...]
#include <stdio.h>
#include <wchar.h>
#include <windows.h>

// Überspringt das erste Wort der Kommandozeile (den Starter selbst).
static wchar_t *skip_first_arg(wchar_t *line)
{
    int quoted = 0;
    while (*line && (quoted || (*line != L' ' && *line != L'\t'))) {
        if (*line == L'"') {
            quoted = !quoted;
        }
        line++;
    }
    while (*line == L' ' || *line == L'\t') {
        line++;
    }
    return line;
}

static const char *crash_text(DWORD code)
{
    switch (code) {
    case 0xC0000005: return "Unerlaubter Speicherzugriff (ungültiger Zeiger)";
    case 0xC000001D: return "Undefiniertes Verhalten: Nullzeiger, Feldgrenze, "
                            "Überlauf oder Division durch null";
    case 0xC0000094: return "Ganzzahlige Division durch null";
    case 0xC00000FD: return "Stacküberlauf, oft eine Rekursion ohne Abbruch";
    case 0xC0000374: return "Heap beschädigt (Schreiben über Speichergrenzen)";
    case 0xC0000409: return "Puffer auf dem Stack überschrieben";
    case 0xC0000135: return "Eine benötigte DLL wurde nicht gefunden";
    default:         return NULL;
    }
}

int main(void)
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);

    wchar_t *command = skip_first_arg(GetCommandLineW());
    STARTUPINFOW si = {.cb = sizeof(si)};
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, command, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        DWORD error = GetLastError();
        if (error == ERROR_ACCESS_DISABLED_BY_POLICY) {
            puts("\n\033[31mWindows blockiert das Programm durch eine Richtlinie. "
                 "Bitte an die IT wenden.\033[0m");
        } else {
            printf("\n\033[31mDas Programm ließ sich nicht starten "
                   "(Windows-Fehler %lu).\033[0m\n", error);
        }
        return 127;
    }

    // Strg+C soll nur das Programm treffen, der Starter wartet weiter.
    SetConsoleCtrlHandler(NULL, TRUE);
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);

    const char *text = crash_text(code);
    if (text) {
        printf("\n\033[31mProgramm abgestürzt: %s.\033[0m\n", text);
    } else if (code == 0xC000013A) {
        puts("\n\033[33mProgramm abgebrochen (Strg+C).\033[0m");
    } else if (code == 0) {
        puts("\n\033[32mProgramm beendet.\033[0m");
    } else {
        printf("\n\033[33mProgramm beendet mit Rückgabewert %ld.\033[0m\n", (long)code);
    }
    return (int)code;
}
