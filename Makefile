CC      = gcc
CFLAGS  = -Wall -Wextra -O2
LDFLAGS = -lpthread
PYTHON ?= python3

TARGET  = boating
SRC     = boating.c

# Simulation settings (5 <= M <= 20, 20 <= N <= 200, 1 <= SPEED <= 200)
M     ?= 5
N     ?= 20
SPEED ?= 100

.PHONY: all run check clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $(TARGET) $(SRC) $(LDFLAGS)

run: $(TARGET)
	./$(TARGET) --boats $(M) --visitors $(N) --ms-per-min $(SPEED)

# Fast run piped through the event validator.
check: $(TARGET)
	./$(TARGET) --boats $(M) --visitors $(N) --ms-per-min 2 | $(PYTHON) tests/check_events.py

clean:
	rm -f $(TARGET) $(TARGET).exe
