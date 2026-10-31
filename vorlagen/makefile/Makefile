CC      = gcc
CFLAGS  = -std=c17 -Wall -Wextra -g -Iinclude
LDLIBS  = -lm
EXE     = build/programm.exe
SOURCES = $(wildcard src/*.c)
OBJECTS = $(SOURCES:src/%.c=build/%.o)

all: $(EXE)

$(EXE): $(OBJECTS)
	$(CC) $(CFLAGS) $^ $(LDLIBS) -o $@

build/%.o: src/%.c $(wildcard include/*.h) | build
	$(CC) $(CFLAGS) -c $< -o $@

build:
	mkdir -p build

run: $(EXE)
	./$(EXE)

clean:
	rm -rf build

.PHONY: all run clean
