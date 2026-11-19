#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <time.h>
#include <getopt.h>
#include <pthread.h>

#define MMIN 5          // boats
#define MMAX 20
#define NMIN 20         // visitors
#define NMAX 200
#define SPEED_MIN 1     // real milliseconds per simulated minute
#define SPEED_MAX 200
#define SIGHT_LIMIT 240 // longest allowed sightseeing time (simulated minutes)
#define RIDE_LIMIT 120  // longest allowed ride time (simulated minutes)
#define THREAD_STACK (256 * 1024)

typedef struct {
    int value;
    pthread_mutex_t mtx;
    pthread_cond_t cv;
} semaphore;
#define SEMAPHORE_INITIALIZER {0, PTHREAD_MUTEX_INITIALIZER, PTHREAD_COND_INITIALIZER}

// Simulation settings (set once in main from the command line, then read-only).
int m = MMIN, n = NMIN;
int ms_per_min = 100;
int sight_min = 30, sight_max = 120;
int ride_min = 15, ride_max = 60;

int vis_left;
bool done = false;          // set by main once the last ride is over (under bmtx)
semaphore boat, rider;
pthread_mutex_t bmtx;
pthread_barrier_t EOS;
bool BA[MMAX];
pthread_barrier_t BB[MMAX];
int BC[MMAX];
int BT[MMAX];

// Each visitor's times are drawn in main (single-threaded) and handed over,
// because rand() is not thread-safe: on Windows each thread even gets its own
// unseeded rand() state, so every visitor would draw identical times.
typedef struct {
    int id;
    int vtime;
    int rtime;
} visitor_arg;

// ---------------------------------------------------------------- output --
// Every line of output is one JSON event, written by emit(). The timestamp is
// read while holding out_mtx, so events come out in non-decreasing time order,
// whole lines never interleave, and each line is flushed at once so a reader
// on the other end of a pipe sees it immediately. out_mtx is a leaf lock: no
// other lock is ever taken while holding it.
static pthread_mutex_t out_mtx = PTHREAD_MUTEX_INITIALIZER;
static struct timespec t0;

static long elapsed_ms(void){
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long)(now.tv_sec - t0.tv_sec) * 1000L
         + (long)(now.tv_nsec - t0.tv_nsec) / 1000000L;
}

// `fields` is a printf format for the extra JSON fields, starting with a comma.
static void emit(const char *type, const char *fields, ...)
    __attribute__((format(printf, 2, 3)));
static void emit(const char *type, const char *fields, ...){
    pthread_mutex_lock(&out_mtx);
    printf("{\"type\":\"%s\",\"t\":%ld", type, elapsed_ms());
    va_list ap;
    va_start(ap, fields);
    vprintf(fields, ap);
    va_end(ap);
    fputs("}\n", stdout);
    fflush(stdout);
    pthread_mutex_unlock(&out_mtx);
}

// ----------------------------------------------------------------- time --
static void sleep_ms(long ms){
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    while(nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}

static void sleep_minutes(int minutes){
    sleep_ms((long)minutes * ms_per_min);
}

int rand_range(int lo, int hi){
    return lo + rand() % (hi - lo + 1);
}

// ------------------------------------------------------------ semaphore --
// Wait. The waiter consumes a unit only once one is actually available, so a
// single V() releases exactly one P(). Re-checking in a while loop keeps this
// correct under spurious wakeups and without assuming the condition queue is
// FIFO -- a thread woken out of turn simply finds value == 0 and waits again.
void P(semaphore *s){
    pthread_mutex_lock(&(s->mtx));
    while(s->value <= 0) pthread_cond_wait(&(s->cv), &(s->mtx));
    s->value--;
    pthread_mutex_unlock(&(s->mtx));
}

// Signal
void V(semaphore *s){
    pthread_mutex_lock(&(s->mtx));
    s->value++;
    pthread_cond_signal(&(s->cv));
    pthread_mutex_unlock(&(s->mtx));
}

// -------------------------------------------------------------- threads --
void *Boat(void *targ){
    int boat_id = *(int *)targ;
    free(targ);
    pthread_mutex_lock(&bmtx);
    pthread_barrier_init(&BB[boat_id], NULL, 2);
    pthread_mutex_unlock(&bmtx);
    emit("boat_ready", ",\"boat\":%d", boat_id+1);
    while(1){
        P(&boat);

        pthread_mutex_lock(&bmtx);
        if(done){                   // woken by main at shutdown, not by a visitor
            pthread_mutex_unlock(&bmtx);
            break;
        }
        BA[boat_id] = true;
        BC[boat_id] = -1;
        pthread_barrier_t* bar = &BB[boat_id];
        pthread_mutex_unlock(&bmtx);

        V(&rider);

        pthread_barrier_wait(bar);

        pthread_mutex_lock(&bmtx);
        int rtime = BT[boat_id];
        BA[boat_id] = false;
        int vis_id = BC[boat_id];
        pthread_mutex_unlock(&bmtx);

        emit("ride_start", ",\"boat\":%d,\"visitor\":%d,\"ride\":%d", boat_id+1, vis_id+1, rtime);
        sleep_minutes(rtime);
        emit("ride_end", ",\"boat\":%d,\"visitor\":%d", boat_id+1, vis_id+1);

        pthread_mutex_lock(&bmtx);
        vis_left--;
        if(vis_left == 0){
            pthread_mutex_unlock(&bmtx);
            pthread_barrier_wait(&EOS);
            break;
        }
        pthread_mutex_unlock(&bmtx);
    }
    return NULL;
}

void *Visitor(void *targ){
    visitor_arg *a = (visitor_arg *)targ;
    int vis_id = a->id;
    int vtime = a->vtime;
    int rtime = a->rtime;
    free(a);

    emit("visitor_arrive", ",\"visitor\":%d,\"sight\":%d,\"ride\":%d", vis_id+1, vtime, rtime);
    sleep_minutes(vtime);
    emit("visitor_wait", ",\"visitor\":%d", vis_id+1);
    V(&boat);
    P(&rider);

    // Some boat must be available (one just signalled us), but it may not have
    // published BA[] yet if it was preempted. Retry, releasing bmtx and
    // sleeping briefly between scans so the boat can make progress.
    int boat_id = -1;
    pthread_barrier_t* bar = NULL;
    while(boat_id < 0){
        pthread_mutex_lock(&bmtx);
        for(int i = 0; i < m; i++){
            if(BA[i] && BC[i] == -1){
                boat_id = i;
                BC[boat_id] = vis_id;
                BT[boat_id] = rtime;
                bar = &BB[boat_id];
                break;
            }
        }
        pthread_mutex_unlock(&bmtx);
        if(boat_id < 0) sleep_ms(2);
    }

    emit("claim", ",\"visitor\":%d,\"boat\":%d", vis_id+1, boat_id+1);
    pthread_barrier_wait(bar);
    sleep_minutes(rtime);

    emit("visitor_leave", ",\"visitor\":%d", vis_id+1);
    return NULL;
}

// ---------------------------------------------------------- arguments --
static char errbuf[200];

static bool parse_int(const char *s, int *out){
    char *end;
    errno = 0;
    long v = strtol(s, &end, 10);
    if(errno || end == s || *end != '\0' || v < INT_MIN || v > INT_MAX) return false;
    *out = (int)v;
    return true;
}

static bool in_range(const char *name, int v, int lo, int hi){
    if(v >= lo && v <= hi) return true;
    snprintf(errbuf, sizeof errbuf, "%s must be between %d and %d", name, lo, hi);
    return false;
}

// Returns NULL on success, or an error message (no quotes or backslashes, so
// it can be placed in a JSON string as is).
static const char *parse_args(int argc, char *argv[]){
    enum { O_BOATS = 1, O_VISITORS, O_SPEED, O_SMIN, O_SMAX, O_RMIN, O_RMAX };
    static const struct option opts[] = {
        {"boats",      required_argument, NULL, O_BOATS},
        {"visitors",   required_argument, NULL, O_VISITORS},
        {"ms-per-min", required_argument, NULL, O_SPEED},
        {"sight-min",  required_argument, NULL, O_SMIN},
        {"sight-max",  required_argument, NULL, O_SMAX},
        {"ride-min",   required_argument, NULL, O_RMIN},
        {"ride-max",   required_argument, NULL, O_RMAX},
        {NULL, 0, NULL, 0}
    };
    opterr = 0;     // report problems ourselves, as JSON
    int c;
    while((c = getopt_long(argc, argv, "", opts, NULL)) != -1){
        int *target;
        switch(c){
            case O_BOATS:    target = &m; break;
            case O_VISITORS: target = &n; break;
            case O_SPEED:    target = &ms_per_min; break;
            case O_SMIN:     target = &sight_min; break;
            case O_SMAX:     target = &sight_max; break;
            case O_RMIN:     target = &ride_min; break;
            case O_RMAX:     target = &ride_max; break;
            default:
                return "unknown option or missing value; options are --boats --visitors "
                       "--ms-per-min --sight-min --sight-max --ride-min --ride-max";
        }
        if(!parse_int(optarg, target)){
            snprintf(errbuf, sizeof errbuf, "value for --%s must be a whole number",
                     opts[c - 1].name);
            return errbuf;
        }
    }
    if(optind < argc) return "unexpected argument; use --boats N --visitors N";

    if(!in_range("boats", m, MMIN, MMAX)) return errbuf;
    if(!in_range("visitors", n, NMIN, NMAX)) return errbuf;
    if(!in_range("ms-per-min", ms_per_min, SPEED_MIN, SPEED_MAX)) return errbuf;
    if(!in_range("sight-min", sight_min, 1, SIGHT_LIMIT)) return errbuf;
    if(!in_range("sight-max", sight_max, 1, SIGHT_LIMIT)) return errbuf;
    if(!in_range("ride-min", ride_min, 1, RIDE_LIMIT)) return errbuf;
    if(!in_range("ride-max", ride_max, 1, RIDE_LIMIT)) return errbuf;
    if(sight_min > sight_max) return "sight-min must not be greater than sight-max";
    if(ride_min > ride_max) return "ride-min must not be greater than ride-max";
    return NULL;
}

static void create_or_die(pthread_t *t, const pthread_attr_t *attr,
                          void *(*fn)(void *), void *arg){
    int rc = pthread_create(t, attr, fn, arg);
    if(rc != 0){
        emit("error", ",\"message\":\"could not create thread (error %d)\"", rc);
        exit(1);
    }
}

// ----------------------------------------------------------------- main --
int main(int argc, char* argv[]){
    clock_gettime(CLOCK_MONOTONIC, &t0);

    const char *err = parse_args(argc, argv);
    if(err){
        emit("error", ",\"message\":\"%s\"", err);
        return 2;
    }

    emit("config", ",\"boats\":%d,\"visitors\":%d,\"ms_per_min\":%d,"
                   "\"sight\":[%d,%d],\"ride\":[%d,%d]",
         m, n, ms_per_min, sight_min, sight_max, ride_min, ride_max);

    srand(time(NULL));

    vis_left = n;
    boat = (semaphore)SEMAPHORE_INITIALIZER;
    rider = (semaphore)SEMAPHORE_INITIALIZER;
    bmtx = (pthread_mutex_t)PTHREAD_MUTEX_INITIALIZER;
    pthread_barrier_init(&EOS, NULL, 2);

    // Up to 221 threads per run: give each a small stack instead of the
    // multi-megabyte default, so a run stays light inside a container.
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, THREAD_STACK);

    pthread_t boat_thr[MMAX];
    pthread_t vis_thr[NMAX];
    for(int i=0; i<m; i++){
        int* id = (int*)malloc(sizeof(int));
        *id = i;
        create_or_die(&boat_thr[i], &attr, Boat, id);
    }
    for(int i=0; i<n; i++){
        visitor_arg* a = (visitor_arg*)malloc(sizeof(visitor_arg));
        a->id = i;
        a->vtime = rand_range(sight_min, sight_max);
        a->rtime = rand_range(ride_min, ride_max);
        create_or_die(&vis_thr[i], &attr, Visitor, a);
    }
    pthread_attr_destroy(&attr);

    pthread_barrier_wait(&EOS);

    // Every ride is over. The other boats are idle inside P(&boat), waiting for
    // a visitor that will never come. Tell them to stop and wake each one with
    // a token; a boat that wakes and sees `done` exits its loop. (Cancelling
    // them instead is unsafe: a thread cancelled inside pthread_cond_wait()
    // dies holding the mutex, and destroying primitives that other threads may
    // still touch is a use-after-free on some pthread implementations.)
    pthread_mutex_lock(&bmtx);
    done = true;
    pthread_mutex_unlock(&bmtx);
    for(int i=0; i<m; i++) V(&boat);

    // Only once every thread has finished is it safe to destroy what they use.
    for(int i=0; i<m; i++) pthread_join(boat_thr[i], NULL);
    for(int i=0; i<n; i++) pthread_join(vis_thr[i], NULL);
    for(int i=0; i<m; i++) pthread_barrier_destroy(&BB[i]);
    pthread_mutex_destroy(&bmtx);
    pthread_mutex_destroy(&(boat.mtx));
    pthread_mutex_destroy(&(rider.mtx));
    pthread_cond_destroy(&(boat.cv));
    pthread_cond_destroy(&(rider.cv));
    pthread_barrier_destroy(&EOS);

    emit("done", ",\"rides\":%d", n);
    return 0;
}
