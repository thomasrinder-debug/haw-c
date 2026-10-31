CC     = gcc
CFLAGS = -std=c17 -Wall -Wextra -g -Iinclude
EXE    = build/programm.exe
LIB    = build/librechnen.a

# Mit DLL statt statischer Bibliothek: make dll, dann make run-dll.
# Die DLL muss neben dem Programm liegen.

all: $(EXE)

$(EXE): src/main.c $(LIB)
	$(CC) $(CFLAGS) $< -Lbuild -lrechnen -lm -o $@

$(LIB): lib/rechnen.c include/rechnen.h | build
	$(CC) $(CFLAGS) -c $< -o build/rechnen.o
	ar rcs $@ build/rechnen.o

dll: build/programm_dll.exe

build/programm_dll.exe: src/main.c build/rechnen.dll
	$(CC) $(CFLAGS) $< build/rechnen.dll -lm -o $@

build/rechnen.dll: lib/rechnen.c include/rechnen.h | build
	$(CC) $(CFLAGS) -shared $< -o $@

build:
	mkdir -p build

run: $(EXE)
	./$(EXE)

run-dll: dll
	./build/programm_dll.exe

clean:
	rm -rf build

.PHONY: all dll run run-dll clean
