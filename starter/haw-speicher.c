// Speicherprüfung: wird beim Linken dazugebunden und ersetzt malloc, calloc, realloc
// und free (ld --wrap). Der Quelltext der Studierenden bleibt unberührt, ein
// fehlendes #include <stdlib.h> fällt also weiter auf. Findet Lecks, doppeltes
// free, ungültiges free, Schreiben über die Blockgrenzen und nach free. Speicher
// aus Bibliotheksfunktionen wie _strdup wird nicht geprüft. Nicht threadsicher.
// Die Zeile kommt über addr2line aus den Debug-Informationen.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

#define GUARD_SIZE 16
#define GUARD_BYTE 0xFD
#define NEW_BYTE 0xCD
#define FREED_BYTE 0xDD
#define QUARANTINE_LIMIT (64u * 1024u * 1024u)
#define MAX_REPORTS 20

typedef struct block {
    struct block *next;
    size_t size;
    void *alloc_addr;
    void *free_addr;
    int freed;
    int reported;
} __attribute__((aligned(16))) block;

extern void *__real_malloc(size_t size);
extern void __real_free(void *pointer);
extern void *__real_realloc(void *pointer, size_t size);

static block *blocks;
static size_t quarantine;
static unsigned long problems;
static int reports;
static int started;

static unsigned char *user_of(block *b)
{
    return (unsigned char *)(b + 1) + GUARD_SIZE;
}

// Fragt addr2line nach der Stelle. Ohne Debug-Informationen bleibt der Text leer.
static void location(void *address, char *out, size_t size)
{
    char exe[MAX_PATH], shortexe[MAX_PATH], command[2 * MAX_PATH], line[1024];
    out[0] = 0;
    if (!address || !GetModuleFileNameA(NULL, exe, sizeof exe)
        || !GetShortPathNameA(exe, shortexe, sizeof shortexe)) {
        return;
    }
    snprintf(command, sizeof command, "addr2line -e \"%s\" %p", shortexe,
             (void *)((char *)address - 1));
    FILE *pipe = _popen(command, "r");
    if (!pipe) {
        return;
    }
    if (fgets(line, sizeof line, pipe)) {
        line[strcspn(line, " \r\n")] = 0;
        if (line[0] != '?' && !strstr(line, ":?") && !strstr(line, ":0")) {
            snprintf(out, size, "%s", line);
        }
    }
    _pclose(pipe);
}

static const char *base_name(const char *path)
{
    const char *base = path;
    for (const char *c = path; *c; c++) {
        if (*c == '/' || *c == '\\') {
            base = c + 1;
        }
    }
    return base;
}

// Meldet ein Problem im Terminal und, für das Problemfenster, in der Berichtsdatei.
static void report(void *address, const char *text)
{
    char where[1024];
    location(address, where, sizeof where);
    if (address && !where[0]) {
        return; // Stelle außerhalb des eigenen Codes, etwa in der C-Laufzeit
    }
    problems++;
    if (++reports > MAX_REPORTS) {
        return;
    }
    fflush(stdout);
    fprintf(stderr, "\033[33mSpeicherprüfung: %s%s%s\033[0m\n", where[0] ? base_name(where) : "",
            where[0] ? ": " : "", text);
    const char *file = getenv("HAW_SPEICHER_BERICHT");
    if (file && where[0]) {
        FILE *out = fopen(file, "a");
        if (out) {
            fprintf(out, "%s|%s\n", where, text);
            fclose(out);
        }
    }
}

static int guards_intact(block *b)
{
    unsigned char *before = (unsigned char *)(b + 1);
    unsigned char *after = user_of(b) + b->size;
    for (int i = 0; i < GUARD_SIZE; i++) {
        if (before[i] != GUARD_BYTE || after[i] != GUARD_BYTE) {
            return 0;
        }
    }
    return 1;
}

static void check_guards(block *b)
{
    if (!b->reported && !guards_intact(b)) {
        char text[128];
        b->reported = 1;
        snprintf(text, sizeof text, "über die Grenzen dieses Blocks (%llu Bytes) geschrieben",
                 (unsigned long long)b->size);
        report(b->alloc_addr, text);
    }
}

static int uses_heap(void)
{
    char where[1024];
    int tries = 0;
    for (block *b = blocks; b && tries < 16; b = b->next, tries++) {
        location(b->alloc_addr, where, sizeof where);
        if (where[0]) {
            return 1;
        }
    }
    return 0;
}

static void check_all(void)
{
    for (block *b = blocks; b; b = b->next) {
        check_guards(b);
        if (b->freed) {
            unsigned char *user = user_of(b);
            for (size_t i = 0; i < b->size; i++) {
                if (user[i] != FREED_BYTE) {
                    report(b->free_addr, "nach diesem free wurde in den Block noch geschrieben");
                    break;
                }
            }
        } else {
            char text[128];
            snprintf(text, sizeof text, "Speicherleck: %llu Bytes hier angefordert, nie freigegeben",
                     (unsigned long long)b->size);
            report(b->alloc_addr, text);
        }
    }
    // Erfolgsmeldung nur, wenn das Programm selbst Speicher angefordert hat; auch
    // die C-Laufzeit ruft malloc auf, ein Hallo-Welt soll dazu nichts melden.
    if (problems == 0 && uses_heap()) {
        fflush(stdout);
        fputs("\033[32mSpeicherprüfung: aller angeforderter Speicher ist freigegeben.\033[0m\n", stderr);
    }
}

static void *allocate(size_t size, void *address)
{
    if (!started) {
        started = 1;
        atexit(check_all);
    }
    block *b = __real_malloc(sizeof(block) + 2 * GUARD_SIZE + size);
    if (!b) {
        return NULL;
    }
    memset(b, 0, sizeof *b);
    b->size = size;
    b->alloc_addr = address;
    b->next = blocks;
    blocks = b;
    memset(b + 1, GUARD_BYTE, GUARD_SIZE);
    memset(user_of(b), NEW_BYTE, size);
    memset(user_of(b) + size, GUARD_BYTE, GUARD_SIZE);
    return user_of(b);
}

static block *find(void *pointer)
{
    for (block *b = blocks; b; b = b->next) {
        if (user_of(b) == (unsigned char *)pointer) {
            return b;
        }
    }
    return NULL;
}

// Speicher aus Bibliotheksfunktionen wie _strdup läuft nicht über __wrap_malloc,
// liegt aber auf dem Heap der C-Laufzeit und darf normal freigegeben werden.
static int from_library(void *pointer)
{
    return HeapValidate((HANDLE)_get_heap_handle(), 0, pointer) != 0;
}

static void release(void *pointer, void *address)
{
    if (!pointer) {
        return;
    }
    block *b = find(pointer);
    if (!b) {
        if (from_library(pointer)) {
            __real_free(pointer);
        } else {
            report(address, "free auf einen Zeiger, der nicht von malloc stammt");
        }
        return;
    }
    if (b->freed) {
        report(address, "doppeltes free: dieser Block ist schon freigegeben");
        return;
    }
    check_guards(b);
    b->freed = 1;
    b->free_addr = address;
    memset(pointer, FREED_BYTE, b->size);
    quarantine += b->size;
    // Freigegebene Blöcke bleiben liegen, damit ein späterer Zugriff auffällt.
    while (quarantine > QUARANTINE_LIMIT) {
        block **link = &blocks;
        block *oldest = NULL, **oldest_link = NULL;
        for (; *link; link = &(*link)->next) {
            if ((*link)->freed) {
                oldest = *link;
                oldest_link = link;
            }
        }
        if (!oldest) {
            break;
        }
        *oldest_link = oldest->next;
        quarantine -= oldest->size;
        __real_free(oldest);
    }
}

void *__wrap_malloc(size_t size)
{
    return allocate(size, __builtin_return_address(0));
}

void *__wrap_calloc(size_t count, size_t size)
{
    if (size && count > SIZE_MAX / size) {
        return NULL;
    }
    void *pointer = allocate(count * size, __builtin_return_address(0));
    if (pointer) {
        memset(pointer, 0, count * size);
    }
    return pointer;
}

void *__wrap_realloc(void *pointer, size_t size)
{
    void *address = __builtin_return_address(0);
    if (!pointer) {
        return allocate(size, address);
    }
    if (size == 0) {
        release(pointer, address);
        return NULL;
    }
    block *b = find(pointer);
    if (!b && from_library(pointer)) {
        return __real_realloc(pointer, size);
    }
    if (!b || b->freed) {
        report(address, "realloc auf einen ungültigen oder schon freigegebenen Zeiger");
        return NULL;
    }
    void *fresh = allocate(size, address);
    if (fresh) {
        memcpy(fresh, pointer, b->size < size ? b->size : size);
        release(pointer, address);
    }
    return fresh;
}

void __wrap_free(void *pointer)
{
    release(pointer, __builtin_return_address(0));
}

