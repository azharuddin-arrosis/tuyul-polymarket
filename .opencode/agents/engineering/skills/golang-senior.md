---
name: golang-senior
description: "Expert-level Go engineering skill — concurrency, latency optimization, security, memory management, and production patterns for senior/staff engineers"
type: skill
language: go
level: senior
version: 1.0.0
---

# Senior Golang — Expert Skill Reference

> Load this skill when implementing ANY Go code. This document defines patterns, standards,
> and anti-patterns at senior/staff engineer level. Read completely before writing a single line.

---

## 1. CONCURRENCY

Go's concurrency model is its greatest strength and the source of most production bugs.
Master this or ship incidents.

### 1.1 Goroutine Lifecycle — Never Leak

Every goroutine you spawn must have a defined exit condition.
A goroutine with no exit = memory leak that never shows up in unit tests.

```go
// ❌ LEAK — goroutine blocked forever if channel never receives
func process(jobs <-chan Job) {
    go func() {
        for job := range jobs { // blocks forever if jobs is never closed
            handle(job)
        }
    }()
}

// ✅ CORRECT — context-cancellable, clean exit
func process(ctx context.Context, jobs <-chan Job) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return // clean exit
            case job, ok := <-jobs:
                if !ok {
                    return // channel closed
                }
                handle(job)
            }
        }
    }()
}
```

**Rules:**
- Every goroutine must be cancelled via `context.Context` or channel close
- Always use `errgroup.Group` for goroutine groups with error propagation
- Use `sync.WaitGroup` only when you don't need error aggregation

```go
// ✅ errgroup — errors propagate, goroutines coordinated
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))

    for i, url := range urls {
        i, url := i, url // capture loop vars — critical in Go <1.22
        g.Go(func() error {
            r, err := fetch(ctx, url)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", url, err)
            }
            results[i] = r
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

---

### 1.2 Channel Patterns

```go
// Pipeline pattern — composable, cancellable
func generator(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out) // ALWAYS close on the producer side
        for _, n := range nums {
            select {
            case out <- n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Fan-out — distribute work across N workers
func fanOut(ctx context.Context, in <-chan Work, workers int) []<-chan Result {
    channels := make([]<-chan Result, workers)
    for i := range channels {
        channels[i] = worker(ctx, in) // all workers read from same channel
    }
    return channels
}

// Fan-in — merge N channels into one
func fanIn(ctx context.Context, channels ...<-chan Result) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup

    forward := func(ch <-chan Result) {
        defer wg.Done()
        for r := range ch {
            select {
            case out <- r:
            case <-ctx.Done():
                return
            }
        }
    }

    wg.Add(len(channels))
    for _, ch := range channels {
        go forward(ch)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

**Channel sizing rules:**
- Unbuffered (`make(chan T)`): synchronization between goroutines — use when sender must wait for receiver
- Buffered (`make(chan T, N)`): decouple producer/consumer speed — size = expected burst, not "make it big"
- Never use a channel size > 1000 without explicit justification — it's hiding a backpressure problem

---

### 1.3 Sync Primitives

```go
// sync.Mutex — protect shared state
type SafeCache struct {
    mu    sync.RWMutex
    items map[string]Item
}

func (c *SafeCache) Get(key string) (Item, bool) {
    c.mu.RLock()         // read lock — allows concurrent reads
    defer c.mu.RUnlock()
    item, ok := c.items[key]
    return item, ok
}

func (c *SafeCache) Set(key string, item Item) {
    c.mu.Lock()          // write lock — exclusive
    defer c.mu.Unlock()
    c.items[key] = item
}

// sync.Once — guaranteed single initialization
type Service struct {
    once   sync.Once
    client *http.Client
}

func (s *Service) getClient() *http.Client {
    s.once.Do(func() {
        s.client = &http.Client{Timeout: 10 * time.Second}
    })
    return s.client
}

// sync/atomic — lock-free counter, flag
type Metrics struct {
    requests atomic.Int64
    errors   atomic.Int64
}

func (m *Metrics) Inc() { m.requests.Add(1) }
func (m *Metrics) Err() { m.errors.Add(1) }

// sync.Pool — reuse allocations, reduce GC pressure
var bufPool = sync.Pool{
    New: func() any {
        return new(bytes.Buffer)
    },
}

func process(data []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()
    buf.Write(data)
    return buf.String()
}
```

**Anti-patterns:**
```go
// ❌ Copying mutex — NEVER copy a struct containing a mutex
type Counter struct { mu sync.Mutex; n int }
c1 := Counter{}
c2 := c1   // BUG: mutex copied in locked/unlocked state is undefined behavior
// ✅ Always pass mutex-containing structs by pointer

// ❌ Lock then defer in a loop — defer runs at function end, not loop iteration end
for _, item := range items {
    mu.Lock()
    defer mu.Unlock() // WRONG: unlocks after ALL iterations complete
    process(item)
}
// ✅ Use closure
for _, item := range items {
    func() {
        mu.Lock()
        defer mu.Unlock()
        process(item)
    }()
}
```

---

### 1.4 Context — The Right Way

```go
// Context carries: cancellation, deadline, request-scoped values
// Rule: NEVER store context in a struct. Pass it as first param.

// ✅ Correct — context as first param
func (s *OrderService) Create(ctx context.Context, dto CreateOrderDTO) (*Order, error) {
    // Check cancellation before expensive work
    if err := ctx.Err(); err != nil {
        return nil, fmt.Errorf("context cancelled before create: %w", err)
    }

    // Propagate to all downstream calls
    order, err := s.repo.Insert(ctx, dto)
    if err != nil {
        return nil, err
    }

    if err := s.notifier.Send(ctx, order); err != nil {
        // Log but don't fail — notification is non-critical
        s.logger.Warn("notification failed", "orderId", order.ID, "err", err)
    }

    return order, nil
}

// Context values — use typed keys to avoid collisions
type contextKey string

const (
    requestIDKey contextKey = "requestID"
    userIDKey    contextKey = "userID"
)

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, requestIDKey, id)
}

func RequestIDFrom(ctx context.Context) (string, bool) {
    id, ok := ctx.Value(requestIDKey).(string)
    return id, ok
}

// Timeout — always set a deadline on outbound calls
func (c *Client) Get(ctx context.Context, url string) (*Response, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel() // ALWAYS defer cancel to release resources

    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil {
        return nil, err
    }
    return c.http.Do(req)
}
```

---

## 2. LATENCY OPTIMIZATION

### 2.1 Profiling — Measure Before Optimizing

```go
// CPU profiling in production
import _ "net/http/pprof" // register pprof handlers

// In main:
go func() {
    log.Println(http.ListenAndServe("localhost:6060", nil))
}()

// Then: go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
// Flame graph: go tool pprof -http=:8080 cpu.prof

// Benchmark — always benchmark before claiming "it's faster"
func BenchmarkProcess(b *testing.B) {
    data := generateTestData()
    b.ReportAllocs() // show allocation count — critical for latency work
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        _ = Process(data)
    }
}

// Run: go test -bench=BenchmarkProcess -benchmem -count=5
// -benchmem: shows allocs/op and bytes/op
// -count=5: run 5 times for statistical stability
```

### 2.2 Memory Allocation Reduction

Every allocation = GC pressure = latency spikes. Target zero-alloc hot paths.

```go
// ❌ Allocates on every call
func buildQuery(filters []string) string {
    result := ""
    for _, f := range filters {
        result += f + " AND " // N allocations
    }
    return result
}

// ✅ Pre-allocated builder
func buildQuery(filters []string) string {
    if len(filters) == 0 {
        return ""
    }
    var b strings.Builder
    b.Grow(len(filters) * 20) // pre-alloc estimate
    for i, f := range filters {
        if i > 0 {
            b.WriteString(" AND ")
        }
        b.WriteString(f)
    }
    return b.String()
}

// ✅ Slice pre-allocation
func processItems(items []Item) []Result {
    results := make([]Result, 0, len(items)) // pre-alloc capacity
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}

// ✅ Escape analysis — keep allocations on stack
// Small structs passed by value stay on stack
// Large structs / anything that outlives function → heap
// Use go build -gcflags="-m" to see escape analysis decisions

// ✅ Struct field ordering — pack fields to reduce padding
// ❌ Wasteful (padding between fields)
type Bad struct {
    flag   bool    // 1 byte + 7 bytes padding
    count  int64   // 8 bytes
    name   string  // 16 bytes
    active bool    // 1 byte + 7 bytes padding
} // total: 40 bytes

// ✅ Optimal — large fields first, then smaller ones
type Good struct {
    count  int64   // 8 bytes
    name   string  // 16 bytes
    flag   bool    // 1 byte
    active bool    // 1 byte + 6 bytes padding
} // total: 32 bytes
```

### 2.3 I/O Latency

```go
// Buffered I/O — reduce syscall count
func writeFile(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()

    w := bufio.NewWriterSize(f, 64*1024) // 64KB buffer
    if _, err := w.Write(data); err != nil {
        return err
    }
    return w.Flush() // flush BEFORE defer close
}

// HTTP connection pooling — reuse connections
var httpClient = &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 20,
        IdleConnTimeout:     90 * time.Second,
        DisableCompression:  false,
    },
    Timeout: 10 * time.Second,
}
// NEVER create http.Client per request — kills connection reuse

// Database connection pool
db, err := sql.Open("postgres", dsn)
db.SetMaxOpenConns(25)           // max concurrent connections
db.SetMaxIdleConns(10)           // keep alive connections
db.SetConnMaxLifetime(5 * time.Minute) // recycle connections

// Batch DB operations — N queries → 1 query
// ❌ N+1
for _, userID := range userIDs {
    user, _ := db.QueryRow("SELECT * FROM users WHERE id = $1", userID)
}

// ✅ Batch query
rows, err := db.QueryContext(ctx,
    "SELECT * FROM users WHERE id = ANY($1)",
    pq.Array(userIDs),
)
```

### 2.4 Caching Patterns

```go
// In-memory cache with TTL — use sync.Map or mutex-protected map
type TTLCache[K comparable, V any] struct {
    mu    sync.RWMutex
    items map[K]cacheItem[V]
}

type cacheItem[V any] struct {
    value     V
    expiresAt time.Time
}

func (c *TTLCache[K, V]) Get(key K) (V, bool) {
    c.mu.RLock()
    item, ok := c.items[key]
    c.mu.RUnlock()

    if !ok || time.Now().After(item.expiresAt) {
        var zero V
        return zero, false
    }
    return item.value, true
}

// Single-flight — prevent cache stampede (thundering herd)
import "golang.org/x/sync/singleflight"

type UserService struct {
    sf    singleflight.Group
    cache *TTLCache[string, *User]
    repo  UserRepository
}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    if user, ok := s.cache.Get(id); ok {
        return user, nil
    }

    // Only ONE goroutine fetches for the same key; others wait for the result
    v, err, _ := s.sf.Do(id, func() (any, error) {
        return s.repo.FindByID(ctx, id)
    })
    if err != nil {
        return nil, err
    }

    user := v.(*User)
    s.cache.Set(id, user, 5*time.Minute)
    return user, nil
}
```

---

## 3. SECURITY

### 3.1 Input Validation & Injection Prevention

```go
// ✅ Parameterized queries — NEVER string interpolation
func (r *OrderRepo) FindByUser(ctx context.Context, userID string) ([]*Order, error) {
    // ✅ Safe
    rows, err := r.db.QueryContext(ctx,
        "SELECT id, total, status FROM orders WHERE user_id = $1 AND deleted_at IS NULL",
        userID,
    )

    // ❌ NEVER DO THIS — SQL injection
    // query := "SELECT * FROM orders WHERE user_id = '" + userID + "'"
    return scanOrders(rows, err)
}

// Input validation — validate at boundary, fail fast
type CreateOrderRequest struct {
    UserID   string  `json:"userId" validate:"required,uuid4"`
    Amount   float64 `json:"amount" validate:"required,gt=0,lte=100000"`
    Currency string  `json:"currency" validate:"required,iso4217"`
    Items    []Item  `json:"items" validate:"required,min=1,max=100,dive"`
}

// Use go-playground/validator for struct validation
var validate = validator.New()

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON", http.StatusBadRequest)
        return
    }

    if err := validate.Struct(req); err != nil {
        // Return validation errors — sanitize, don't expose raw validator output
        errs := mapValidationErrors(err)
        writeJSON(w, http.StatusUnprocessableEntity, errs)
        return
    }
    // ...
}

// Path traversal prevention
func serveFile(w http.ResponseWriter, r *http.Request) {
    filename := r.URL.Query().Get("file")

    // ❌ DANGEROUS
    // http.ServeFile(w, r, "/uploads/"+filename)

    // ✅ Clean and validate path
    cleanName := filepath.Base(filepath.Clean(filename))
    if cleanName == "." || cleanName == "/" || strings.Contains(cleanName, "..") {
        http.Error(w, "invalid filename", http.StatusBadRequest)
        return
    }

    safePath := filepath.Join("/uploads", cleanName)
    http.ServeFile(w, r, safePath)
}
```

### 3.2 Authentication & Authorization

```go
// JWT — production-grade handling
import "github.com/golang-jwt/jwt/v5"

type Claims struct {
    UserID string `json:"sub"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

func (s *AuthService) ValidateToken(tokenStr string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &Claims{},
        func(token *jwt.Token) (any, error) {
            // CRITICAL: validate signing method — prevent "alg:none" attack
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
            }
            return s.secret, nil
        },
        jwt.WithExpirationRequired(),
        jwt.WithIssuedAt(),
    )
    if err != nil {
        return nil, fmt.Errorf("invalid token: %w", err)
    }

    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, errors.New("invalid token claims")
    }
    return claims, nil
}

// Middleware — auth + authz separated
func AuthMiddleware(authSvc *AuthService) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            authHeader := r.Header.Get("Authorization")
            if !strings.HasPrefix(authHeader, "Bearer ") {
                http.Error(w, "missing token", http.StatusUnauthorized)
                return
            }

            claims, err := authSvc.ValidateToken(strings.TrimPrefix(authHeader, "Bearer "))
            if err != nil {
                http.Error(w, "invalid token", http.StatusUnauthorized)
                return
            }

            // Inject claims into context — downstream uses typed key
            ctx := WithClaims(r.Context(), claims)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

// Authorization — resource-level, not just role-level
func (s *OrderService) Update(ctx context.Context, orderID string, dto UpdateOrderDTO) (*Order, error) {
    claims, ok := ClaimsFrom(ctx)
    if !ok {
        return nil, ErrUnauthenticated
    }

    order, err := s.repo.FindByID(ctx, orderID)
    if err != nil {
        return nil, err
    }

    // Resource ownership check — not just "is logged in"
    if order.UserID != claims.UserID && claims.Role != "admin" {
        return nil, ErrForbidden // don't leak that the order exists
    }

    return s.repo.Update(ctx, order, dto)
}
```

### 3.3 Cryptography

```go
// Password hashing — use bcrypt or argon2id, NEVER md5/sha1/sha256
import "golang.org/x/crypto/bcrypt"

const bcryptCost = 12 // min 12 in production; benchmark on your hardware

func HashPassword(password string) (string, error) {
    if len(password) > 72 { // bcrypt truncates at 72 bytes
        return "", errors.New("password exceeds maximum length")
    }
    hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
    return string(hash), err
}

func CheckPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

// Secure random tokens — use crypto/rand, NEVER math/rand
func GenerateToken(n int) (string, error) {
    b := make([]byte, n)
    if _, err := rand.Read(b); err != nil {
        return "", fmt.Errorf("generate token: %w", err)
    }
    return base64.URLEncoding.EncodeToString(b), nil
}

// Constant-time comparison — prevent timing attacks
import "crypto/subtle"

func compareTokens(a, b string) bool {
    // ❌ VULNERABLE to timing attack
    // return a == b

    // ✅ Constant-time comparison
    return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// TLS — enforce minimum version
tlsConfig := &tls.Config{
    MinVersion:               tls.VersionTLS13,
    PreferServerCipherSuites: true,
    CurvePreferences: []tls.CurveID{
        tls.X25519,
        tls.CurveP256,
    },
}
```

### 3.4 Secrets Management

```go
// ❌ NEVER hardcode secrets
const dbPassword = "supersecret123" // fired on sight

// ✅ Environment-based config with validation at startup
type Config struct {
    DBPassword  string
    JWTSecret   []byte
    APIKey      string
}

func LoadConfig() (*Config, error) {
    cfg := &Config{
        DBPassword: os.Getenv("DB_PASSWORD"),
        JWTSecret:  []byte(os.Getenv("JWT_SECRET")),
        APIKey:     os.Getenv("API_KEY"),
    }

    // Validate at startup — fail fast, not at 3am
    var errs []string
    if cfg.DBPassword == "" {
        errs = append(errs, "DB_PASSWORD is required")
    }
    if len(cfg.JWTSecret) < 32 {
        errs = append(errs, "JWT_SECRET must be at least 32 bytes")
    }
    if len(errs) > 0 {
        return nil, fmt.Errorf("config validation failed:\n%s", strings.Join(errs, "\n"))
    }
    return cfg, nil
}

// ✅ Secrets never in logs
func (s *Service) Connect(cfg *Config) error {
    s.logger.Info("connecting to database",
        "host", cfg.DBHost,
        // "password", cfg.DBPassword ← NEVER LOG SECRETS
    )
    return s.db.Ping()
}
```

### 3.5 HTTP Security Headers

```go
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("X-XSS-Protection", "1; mode=block")
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        w.Header().Set("Permissions-Policy", "geolocation=(), microphone=()")
        w.Header().Set("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'")

        if r.TLS != nil {
            w.Header().Set("Strict-Transport-Security",
                "max-age=63072000; includeSubDomains; preload")
        }
        next.ServeHTTP(w, r)
    })
}

// Rate limiting — protect against brute force and DoS
import "golang.org/x/time/rate"

type RateLimiter struct {
    limiters sync.Map
    rate     rate.Limit
    burst    int
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
    v, _ := rl.limiters.LoadOrStore(key, rate.NewLimiter(rl.rate, rl.burst))
    return v.(*rate.Limiter)
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ip := realIP(r)
        if !rl.getLimiter(ip).Allow() {
            http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

## 4. ERROR HANDLING

### 4.1 Sentinel & Typed Errors

```go
// Sentinel errors — for comparison with errors.Is()
var (
    ErrNotFound      = errors.New("not found")
    ErrUnauthorized  = errors.New("unauthorized")
    ErrForbidden     = errors.New("forbidden")
    ErrConflict      = errors.New("conflict")
    ErrInvalidInput  = errors.New("invalid input")
)

// Typed errors — carry context
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on field %q: %s", e.Field, e.Message)
}

// Wrapping — preserve chain for errors.Is / errors.As
func (r *OrderRepo) FindByID(ctx context.Context, id string) (*Order, error) {
    var order Order
    err := r.db.QueryRowContext(ctx, "SELECT ...", id).Scan(&order.ID)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, fmt.Errorf("order %s: %w", id, ErrNotFound) // wrap sentinel
    }
    if err != nil {
        return nil, fmt.Errorf("query order %s: %w", id, err) // wrap with context
    }
    return &order, nil
}

// Caller can check:
order, err := repo.FindByID(ctx, id)
if errors.Is(err, ErrNotFound) {
    // 404
}

var ve *ValidationError
if errors.As(err, &ve) {
    // handle validation error with field info
}
```

### 4.2 Error Handling at Layer Boundaries

```go
// Repository: wrap DB errors, translate to domain errors
// Service: add business context, handle domain logic errors
// Handler: map domain errors to HTTP status codes

func (h *OrderHandler) mapError(err error) (int, string) {
    switch {
    case errors.Is(err, ErrNotFound):
        return http.StatusNotFound, "resource not found"
    case errors.Is(err, ErrForbidden):
        return http.StatusForbidden, "access denied"
    case errors.Is(err, ErrConflict):
        return http.StatusConflict, "resource conflict"
    case errors.Is(err, ErrInvalidInput):
        return http.StatusUnprocessableEntity, err.Error()
    default:
        // Log internal error, don't expose details to client
        h.logger.Error("internal error", "err", err)
        return http.StatusInternalServerError, "internal server error"
    }
}
```

---

## 5. MEMORY MANAGEMENT & GC

```go
// GOGC tuning — balance throughput vs latency
// GOGC=100 (default): GC when heap doubles
// GOGC=200: less frequent GC, more memory usage, better throughput
// GOGC=50: more frequent GC, lower memory, higher CPU
// For latency-sensitive: use GOMEMLIMIT (Go 1.19+)

// GOMEMLIMIT — hard memory ceiling, prevents OOM
// Set via env: GOMEMLIMIT=500MiB
// Or in code:
import "runtime/debug"
debug.SetMemoryLimit(500 * 1024 * 1024) // 500MB

// Large object reuse — avoid GC scanning large slices
type Worker struct {
    buf []byte // reused across operations
}

func (w *Worker) Process(data []byte) []byte {
    // Reuse buffer if large enough
    if cap(w.buf) < len(data)*2 {
        w.buf = make([]byte, len(data)*2)
    }
    w.buf = w.buf[:len(data)]
    copy(w.buf, data)
    return transform(w.buf)
}

// Slice tricks — avoid unnecessary copies
// Append without new allocation when capacity allows:
s := make([]int, 0, 100)
s = append(s, items...) // won't allocate if len(items) <= 100

// Delete element preserving order:
func deleteAt[T any](s []T, i int) []T {
    return append(s[:i], s[i+1:]...)
}

// Delete element (order doesn't matter — faster):
func deleteAtFast[T any](s []T, i int) []T {
    s[i] = s[len(s)-1]
    return s[:len(s)-1]
}
```

---

## 6. TESTING

### 6.1 Table-Driven Tests

```go
func TestOrderService_Create(t *testing.T) {
    tests := []struct {
        name    string
        dto     CreateOrderDTO
        setup   func(*MockRepo)
        want    *Order
        wantErr error
    }{
        {
            name: "creates order with valid items",
            dto:  CreateOrderDTO{Items: []Item{{ProductID: "p1", Qty: 2}}},
            setup: func(m *MockRepo) {
                m.On("Insert", mock.Anything, mock.Anything).Return(&Order{ID: "o1"}, nil)
            },
            want: &Order{ID: "o1"},
        },
        {
            name:    "rejects empty items",
            dto:     CreateOrderDTO{Items: []Item{}},
            setup:   func(m *MockRepo) {}, // no DB call expected
            wantErr: ErrInvalidInput,
        },
        {
            name: "returns error on db failure",
            dto:  CreateOrderDTO{Items: []Item{{ProductID: "p1", Qty: 1}}},
            setup: func(m *MockRepo) {
                m.On("Insert", mock.Anything, mock.Anything).Return(nil, errors.New("db down"))
            },
            wantErr: errors.New("db down"),
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            mockRepo := new(MockRepo)
            tt.setup(mockRepo)

            svc := NewOrderService(mockRepo)
            got, err := svc.Create(context.Background(), tt.dto)

            if tt.wantErr != nil {
                require.Error(t, err)
                assert.ErrorContains(t, err, tt.wantErr.Error())
                return
            }

            require.NoError(t, err)
            assert.Equal(t, tt.want.ID, got.ID)
            mockRepo.AssertExpectations(t)
        })
    }
}
```

### 6.2 Race Detector & Fuzzing

```go
// Race detector — ALWAYS run in CI
// go test -race ./...

// Fuzz testing — Go 1.18+
func FuzzParseOrderID(f *testing.F) {
    // Seed corpus
    f.Add("ord-123")
    f.Add("ord-abc-456")
    f.Add("")

    f.Fuzz(func(t *testing.T, input string) {
        result, err := ParseOrderID(input)
        if err != nil {
            return // invalid input is ok, panic is not
        }
        // Invariant: round-trip must be stable
        if result.String() != input {
            t.Errorf("round-trip failed: %q → %q", input, result.String())
        }
    })
}
// Run: go test -fuzz=FuzzParseOrderID -fuzztime=30s

// Integration tests with real DB — use testcontainers
func TestOrderRepo_Integration(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }

    ctx := context.Background()
    container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Image:        "postgres:16-alpine",
            ExposedPorts: []string{"5432/tcp"},
            Env: map[string]string{
                "POSTGRES_PASSWORD": "test",
                "POSTGRES_DB":       "testdb",
            },
            WaitingFor: wait.ForListeningPort("5432/tcp"),
        },
        Started: true,
    })
    require.NoError(t, err)
    defer container.Terminate(ctx)

    // run migrations, seed data, test
}
```

### 6.3 Benchmark Best Practices

```go
// Always include -benchmem to track allocations
// go test -bench=. -benchmem -count=5 -benchtime=3s

func BenchmarkBuildQuery(b *testing.B) {
    filters := []string{"status = 'active'", "amount > 100", "created_at > '2024-01-01'"}

    b.Run("string_concat", func(b *testing.B) {
        b.ReportAllocs()
        for i := 0; i < b.N; i++ {
            _ = buildQueryConcat(filters)
        }
    })

    b.Run("strings_builder", func(b *testing.B) {
        b.ReportAllocs()
        for i := 0; i < b.N; i++ {
            _ = buildQueryBuilder(filters)
        }
    })
}
```

---

## 7. PRODUCTION PATTERNS

### 7.1 Graceful Shutdown

```go
func main() {
    srv := &http.Server{
        Addr:         ":8080",
        Handler:      router,
        ReadTimeout:  15 * time.Second,
        WriteTimeout: 30 * time.Second,
        IdleTimeout:  120 * time.Second,
    }

    // Start server in goroutine
    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Fatal("server error:", err)
        }
    }()

    // Wait for interrupt signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    log.Println("shutting down...")

    // Give in-flight requests 30 seconds to complete
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        log.Fatal("forced shutdown:", err)
    }

    // Close other resources — DB, message brokers, etc.
    db.Close()
    log.Println("shutdown complete")
}
```

### 7.2 Structured Logging

```go
// Use slog (stdlib Go 1.21+) or zerolog for zero-alloc logging
import "log/slog"

// Initialize with JSON handler for production
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))

// Always include request context in logs
func (s *OrderService) Create(ctx context.Context, dto CreateOrderDTO) (*Order, error) {
    requestID, _ := RequestIDFrom(ctx)
    userID, _    := UserIDFrom(ctx)

    logger := s.logger.With(
        "requestId", requestID,
        "userId", userID,
        "operation", "create_order",
    )

    logger.Info("creating order", "itemCount", len(dto.Items))

    order, err := s.repo.Insert(ctx, dto)
    if err != nil {
        logger.Error("failed to create order", "err", err)
        return nil, err
    }

    logger.Info("order created", "orderId", order.ID, "total", order.Total)
    return order, nil
}
```

### 7.3 Observability — Metrics & Tracing

```go
// Prometheus metrics
import "github.com/prometheus/client_golang/prometheus"

var (
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request duration distribution",
            Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
        },
        []string{"method", "path", "status"},
    )

    activeRequests = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "http_active_requests",
            Help: "Number of active HTTP requests",
        },
        []string{"method", "path"},
    )
)

func MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        rw := &responseWriter{ResponseWriter: w, statusCode: 200}

        activeRequests.WithLabelValues(r.Method, r.URL.Path).Inc()
        defer activeRequests.WithLabelValues(r.Method, r.URL.Path).Dec()

        next.ServeHTTP(rw, r)

        requestDuration.WithLabelValues(
            r.Method,
            r.URL.Path,
            strconv.Itoa(rw.statusCode),
        ).Observe(time.Since(start).Seconds())
    })
}

// OpenTelemetry tracing
import "go.opentelemetry.io/otel"

func (s *OrderService) Create(ctx context.Context, dto CreateOrderDTO) (*Order, error) {
    ctx, span := otel.Tracer("order-service").Start(ctx, "OrderService.Create")
    defer span.End()

    span.SetAttributes(
        attribute.Int("items.count", len(dto.Items)),
        attribute.String("user.id", dto.UserID),
    )

    order, err := s.repo.Insert(ctx, dto) // ctx carries trace context
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return nil, err
    }

    span.SetAttributes(attribute.String("order.id", order.ID))
    return order, nil
}
```

### 7.4 Health Checks

```go
type HealthChecker struct {
    db    *sql.DB
    redis *redis.Client
}

type HealthStatus struct {
    Status     string            `json:"status"` // "healthy" | "degraded" | "unhealthy"
    Version    string            `json:"version"`
    Components map[string]string `json:"components"`
}

func (h *HealthChecker) Check(ctx context.Context) HealthStatus {
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()

    status := HealthStatus{
        Status:     "healthy",
        Version:    version.Build,
        Components: make(map[string]string),
    }

    // DB check
    if err := h.db.PingContext(ctx); err != nil {
        status.Components["database"] = "unhealthy: " + err.Error()
        status.Status = "unhealthy"
    } else {
        status.Components["database"] = "healthy"
    }

    // Redis check
    if err := h.redis.Ping(ctx).Err(); err != nil {
        status.Components["cache"] = "degraded: " + err.Error()
        if status.Status == "healthy" {
            status.Status = "degraded"
        }
    } else {
        status.Components["cache"] = "healthy"
    }

    return status
}

func (h *HealthHandler) Readiness(w http.ResponseWriter, r *http.Request) {
    status := h.checker.Check(r.Context())
    code := http.StatusOK
    if status.Status == "unhealthy" {
        code = http.StatusServiceUnavailable
    }
    writeJSON(w, code, status)
}
```

---

## 8. CODE ORGANIZATION

```
project/
├── cmd/
│   └── api/
│       └── main.go              # wire everything, start server
├── internal/
│   ├── domain/                  # pure business types — no imports from infra
│   │   ├── order/
│   │   │   ├── order.go         # Order struct, business methods
│   │   │   ├── errors.go        # domain errors
│   │   │   └── repository.go    # interface — implemented in infra
│   │   └── user/
│   ├── application/             # use cases — orchestrates domain
│   │   └── order/
│   │       ├── service.go
│   │       └── service_test.go
│   ├── infrastructure/          # DB, external APIs, messaging
│   │   ├── postgres/
│   │   │   └── order_repo.go    # implements domain.OrderRepository
│   │   └── redis/
│   └── transport/               # HTTP, gRPC handlers — thin layer
│       └── http/
│           ├── handler/
│           │   └── order.go
│           └── middleware/
├── pkg/                         # exported, reusable across projects
│   ├── validator/
│   └── logger/
└── config/
```

**Rules:**
- `internal/domain` never imports `internal/infrastructure`
- `internal/application` depends on domain interfaces, not concrete implementations
- `internal/transport` is thin — no business logic
- Dependency direction: transport → application → domain ← infrastructure

---

## 9. QUICK REFERENCE — ANTI-PATTERNS

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Goroutine without exit | Memory leak | Use context cancellation |
| `http.DefaultClient` in production | No timeouts | Create custom client with timeouts |
| String concat in loop | N allocations | `strings.Builder` with `Grow()` |
| `math/rand` for tokens | Predictable | `crypto/rand` |
| `fmt.Sprintf` for error wrapping | Loses error chain | `fmt.Errorf("...: %w", err)` |
| Mutex in struct passed by value | Data race | Always pass by pointer |
| Ignoring `cancel()` from context | Resource leak | Always `defer cancel()` |
| Locking entire handler | Serialized requests | Lock only critical section |
| `panic` for expected errors | Crashes server | Return errors, reserve panic for truly unrecoverable |
| `interface{}` / `any` everywhere | Loses type safety | Use generics (Go 1.18+) or typed interfaces |
| N+1 query | Latency explosion | Batch queries, eager load |
| Direct DB call in handler | Coupled layers | Repository pattern |
