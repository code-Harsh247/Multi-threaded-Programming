CC      = gcc
CFLAGS  = -Wall -Wextra -O2
LDFLAGS = -lpthread

TARGET  = boating
SRC     = boating.c

# Default simulation parameters (5 <= M <= 10, 20 <= N <= 100)
M ?= 5
N ?= 20

.PHONY: all run clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $(TARGET) $(SRC) $(LDFLAGS)

run: $(TARGET)
	./$(TARGET) $(M) $(N)

clean:
	rm -f $(TARGET) $(TARGET).exe
