# Phase 1: Pagination - Research

**Researched:** 2026-02-08
**Domain:** MongoDB pagination, HTMX infinite scroll, Fastify query parameters
**Confidence:** HIGH

## Summary

Pagination for 1000+ builds requires a strategic choice between offset-based (skip/limit) and cursor-based (range query) pagination. For the current phase with 1000+ builds target, **skip/limit pagination is acceptable** as a simpler starting point, but should be monitored for performance degradation beyond 10,000 builds.

MongoDB's skip() operation degrades linearly with page depth (O(n) time complexity), requiring the server to walk through documents from the beginning. For collections with 1000+ documents and deep page traversal, cursor-based pagination becomes essential for maintaining sub-100ms response times.

The existing codebase already uses MongoDB 6.5.0, MongoMemoryServer for testing, Fastify for routing, HTMX for client-side updates, and Handlebars for templating. This phase extends the BuildRepository with paginated queries and enhances dashboard routes with query parameter handling.

**Primary recommendation:** Implement skip/limit pagination with proper indexing for Phase 1 (simple, proven, adequate for <10k builds). Design the repository interface to allow future migration to cursor-based pagination without breaking API contracts.

## Standard Stack

### Core

| Library               | Version | Purpose                                     | Why Standard                                     |
| --------------------- | ------- | ------------------------------------------- | ------------------------------------------------ |
| mongodb               | 6.5.0   | Database driver with cursor/pagination APIs | Already in use, native pagination support        |
| fastify               | 4.26.2  | Web framework with schema validation        | Already in use, built-in querystring validation  |
| htmx                  | 2.x     | Client-side partial updates                 | Already in use, supports infinite scroll pattern |
| handlebars            | 4.7.8   | Server-side templating                      | Already in use, can render pagination UI         |
| vitest                | 1.3.1   | Unit testing framework                      | Already in use, project standard                 |
| @playwright/test      | 1.57.0  | E2E testing framework                       | Already in use, project standard                 |
| mongodb-memory-server | 11.0.1  | In-memory MongoDB for tests                 | Already in use for integration tests             |

### Supporting

| Library | Version | Purpose                        | When to Use                            |
| ------- | ------- | ------------------------------ | -------------------------------------- |
| N/A     | N/A     | No additional libraries needed | Existing stack covers all requirements |

### Alternatives Considered

| Instead of                        | Could Use                  | Tradeoff                                                                                                                  |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Skip/Limit                        | Cursor-based (range query) | Better performance for large datasets (>10k), but more complex implementation and harder to jump to arbitrary pages       |
| Manual pagination HTML            | handlebars-paginate helper | Helper library provides pre-built UI components but adds dependency; manual HTML gives full control                       |
| Query param validation in handler | Fastify schema validation  | Schema validation (recommended) provides automatic type coercion and error handling; manual validation requires more code |

**Installation:**

```bash
# No new dependencies required - using existing stack
```

## Architecture Patterns

### Current Repository Pattern (follows existing codebase conventions)

```
src/
├── repositories/
│   └── buildRepository.ts       # Add findPaginated method here
├── services/
│   └── build/
│       ├── buildService.ts      # Add getBuildsPage method here
│       └── buildService.test.ts # Unit tests for pagination logic
├── server/
│   └── dashboard/
│       ├── index.ts             # Add ?page query param handling
│       └── index.test.ts        # Unit tests for route query params
└── templates/
    └── partials/
        ├── buildTable.hbs       # Add pagination controls
        └── paginationControls.hbs # New partial for prev/next/page numbers
```

### Pattern 1: Repository-Layer Pagination (Skip/Limit)

**What:** Add paginated query method to BuildRepository that accepts page and limit parameters
**When to use:** For collections with <10k documents where arbitrary page jumping is needed
**Example:**

```typescript
// src/repositories/buildRepository.ts
async findPaginated(
  accountId: ObjectId,
  serviceId: ObjectId,
  page: number,
  limit: number,
): Promise<{ builds: Build[]; total: number; hasMore: boolean }> {
  const skip = (page - 1) * limit;

  // Get builds for current page
  const builds = await this.collection
    .find({ accountId, serviceId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  // Get total count for pagination metadata
  const total = await this.collection.countDocuments({ accountId, serviceId });

  return {
    builds,
    total,
    hasMore: skip + builds.length < total,
  };
}
```

**Source:** MongoDB official docs (https://www.mongodb.com/docs/manual/reference/method/cursor.skip/), existing BuildRepository patterns

### Pattern 2: Fastify Query Parameter Schema Validation

**What:** Use Fastify's built-in schema validation for query parameters with type coercion
**When to use:** All routes that accept query parameters
**Example:**

```typescript
// src/server/dashboard/index.ts
server.get<{
  Params: { serviceName: string };
  Querystring: { page?: number };
}>(
  "/dashboard/:serviceName",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
        },
      },
    },
  },
  async (req, reply) => {
    const page = req.query.page ?? 1;
    // ... use page for pagination
  },
);
```

**Source:** Fastify validation docs (https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

### Pattern 3: HTMX Infinite Scroll (Optional Task 1.4)

**What:** Use hx-get, hx-trigger="revealed", and hx-swap="beforeend" for load-more pattern
**When to use:** When infinite scroll UX is preferred over prev/next buttons
**Example:**

```handlebars
{{! Last row acts as trigger for next page }}
<tr
  hx-get="/dashboard/{{serviceName}}?page={{nextPage}}"
  hx-trigger="revealed"
  hx-swap="afterend"
  hx-target="closest tbody"
>
  <td colspan="3">Loading more builds...</td>
</tr>
```

**Source:** HTMX official examples (https://htmx.org/examples/infinite-scroll/)

### Pattern 4: TDD Red-Green-Refactor (Project Convention)

**What:** Write failing test first, implement minimal code to pass, refactor
**When to use:** All production code (per CLAUDE.md mandatory workflow)
**Example:**

```typescript
// buildRepository.test.ts - RED phase
it("should return paginated builds for page 2", async () => {
  // Given: 25 builds exist
  for (let i = 0; i < 25; i++) {
    await repo.create({ accountId, serviceId, buildId: `build-${i}` });
  }

  // When: I request page 2 with limit 10
  const result = await repo.findPaginated(accountId, serviceId, 2, 10);

  // Then: I get builds 11-20
  expect(result.builds).toHaveLength(10);
  expect(result.total).toBe(25);
  expect(result.hasMore).toBe(true);
});
```

**Source:** CLAUDE.md TDD workflow section

### Anti-Patterns to Avoid

- **Loading all builds then slicing in memory:** Defeats purpose of pagination, causes OOM with large datasets
- **Using skip() without indexed sort field:** MongoDB must scan all skipped documents without index benefit
- **Hardcoding page size:** Should be configurable constant (e.g., DEFAULT_PAGE_SIZE = 20)
- **Not testing tenant isolation in pagination:** Must verify pagination respects accountId boundary
- **Forgetting to update updatedAt on status changes:** Could cause pagination inconsistencies

## Don't Hand-Roll

| Problem                          | Don't Build                             | Use Instead                                             | Why                                                                                                 |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Query parameter parsing/coercion | Manual parseInt with error handling     | Fastify schema validation with type coercion            | Handles type coercion, validation, and default values automatically. Prevents invalid page numbers. |
| Pagination metadata calculations | Custom page count math in every handler | Service-layer method returning {builds, total, hasMore} | Centralizes logic, reduces bugs, easier to test.                                                    |
| HTMX infinite scroll boilerplate | Custom JavaScript scroll handlers       | HTMX hx-trigger="revealed" pattern                      | Zero JavaScript needed, works across browsers, 3 HTMX attributes vs 50+ lines of JS.                |

**Key insight:** Pagination has deceptively complex edge cases (empty results, last page, page > total, negative pages). Using Fastify's built-in validation prevents 90% of edge case bugs. MongoDB's native cursor methods handle sort stability and consistent ordering that hand-rolled solutions often break.

## Common Pitfalls

### Pitfall 1: Skip Performance Degradation

**What goes wrong:** App performance degrades as users navigate to later pages. Page 1 loads fast, page 50 takes seconds.
**Why it happens:** MongoDB's skip() walks through documents sequentially from the start. skip(1000) scans and discards 1000 documents even with an index.
**How to avoid:**

- For Phase 1: Monitor query performance metrics, set alerts for >100ms queries
- Document skip/limit performance characteristics in tests
- Use cursor-based pagination (range queries) if dataset grows beyond 10k builds
  **Warning signs:** Slow query logs showing increasing execution time for same query with different skip values
  **Source:** MongoDB docs (https://www.mongodb.com/docs/manual/reference/method/cursor.skip/), performance analysis (https://arpitbhayani.me/blogs/mongodb-cursor-skip-is-slow/)

### Pitfall 2: Missing Index on Sort Field

**What goes wrong:** Pagination queries scan entire collection, causing timeout or high CPU usage
**Why it happens:** MongoDB can't use an index for sort if no index covers the sort field(s)
**How to avoid:**

- Verify BuildRepository.ensureIndexes() creates index on {accountId: 1, serviceId: 1, createdAt: -1}
- Already exists in current implementation (lines 36-40 of buildRepository.ts)
- Run explain() on pagination query in tests to verify index usage
  **Warning signs:** MongoDB explain() shows COLLSCAN instead of IXSCAN
  **Source:** Existing buildRepository.ts implementation, MongoDB indexing best practices

### Pitfall 3: Race Condition with Real-Time Build Updates

**What goes wrong:** User is on page 2, new build arrives via SSE, build appears out of order or duplicates appear
**Why it happens:** Offset-based pagination assumes static dataset. New builds shift page boundaries.
**How to avoid:**

- Accept this limitation for Phase 1 (document in tests/comments)
- SSE already handles new build insertion at top (see buildTable.hbs lines 40-49)
- For perfect consistency, cursor-based pagination required
  **Warning signs:** Users report seeing duplicate builds or missing builds when new ones arrive
  **Source:** Pagination consistency analysis (https://medium.com/swlh/mongodb-pagination-fast-consistent-ece2a97070f3)

### Pitfall 4: Not Testing Pagination Boundaries

**What goes wrong:** Edge cases fail in production (page 0, page beyond total, empty results)
**Why it happens:** Developers test happy path (page 2 of 10) but not boundaries
**How to avoid:**

- Test: page 0 or negative → defaults to page 1
- Test: page beyond total → returns empty array, hasMore=false
- Test: limit 0 or negative → defaults to minimum (1) or maximum (100)
- Test: no builds exist → returns empty array correctly
  **Warning signs:** 500 errors or crashes on edge case inputs
  **Source:** TDD best practices from CLAUDE.md, existing test patterns in buildRepository.test.ts

### Pitfall 5: Querystring vs Query Confusion

**What goes wrong:** Fastify schema validation doesn't work, query params are undefined
**Why it happens:** Fastify normalizes "query" to "querystring" in schemas (historical reasons)
**How to avoid:** Always use "querystring" in schema definition, access as req.query in handler
**Warning signs:** TypeScript types work but runtime validation fails
**Source:** Fastify validation docs (https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), existing codebase patterns (src/server/routes/services/index.ts line 266)

## Code Examples

Verified patterns from official sources and existing codebase:

### MongoDB Paginated Query with Index

```typescript
// Source: Existing buildRepository.ts + MongoDB cursor.skip() docs
async findPaginated(
  accountId: ObjectId,
  serviceId: ObjectId,
  page: number = 1,
  limit: number = 20,
): Promise<{ builds: Build[]; total: number; hasMore: boolean }> {
  // Ensure page and limit are positive integers
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const skip = (safePage - 1) * safeLimit;

  // Query uses existing index: { accountId: 1, serviceId: 1, createdAt: -1 }
  const [builds, total] = await Promise.all([
    this.collection
      .find({ accountId, serviceId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .toArray(),
    this.collection.countDocuments({ accountId, serviceId })
  ]);

  return {
    builds,
    total,
    hasMore: skip + builds.length < total,
  };
}
```

### Fastify Route with Query Schema Validation

```typescript
// Source: Fastify docs + existing codebase patterns (src/server/routes/services/index.ts)
server.get<{
  Params: { serviceName: string };
  Querystring: { page?: number };
}>(
  "/dashboard/:serviceName",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
        },
      },
    },
  },
  async (req, reply) => {
    const accountId = new ObjectId(req.session!.accountId);
    const { serviceName } = req.params;
    const page = req.query.page ?? 1; // Type is number, not string

    // Load paginated builds
    const { builds, total, hasMore } = await buildRepository.findPaginated(
      accountId,
      activeService._id,
      page,
      20, // limit
    );

    // Pass pagination metadata to template
    return reply.view("dashboard", {
      builds: formatBuildsForTemplate(
        builds,
        environments,
        serviceName,
        serviceId,
      ),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / 20),
        hasMore,
        hasPrev: page > 1,
      },
      // ... other template data
    });
  },
);
```

### Handlebars Pagination Controls (Prev/Next)

```handlebars
{{! Source: Handlebars pagination patterns + HTMX attributes }}
{{#if pagination}}
  <div
    class="flex justify-between items-center mt-4 px-4 py-3 border-t border-gray-200 dark:border-gray-700"
  >
    <div>
      {{#if pagination.hasPrev}}
        <a
          href="/dashboard/{{serviceName}}?page={{subtract
            pagination.currentPage
            1
          }}"
          class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          hx-get="/dashboard/{{serviceName}}?page={{subtract
            pagination.currentPage
            1
          }}"
          hx-target="#build-table"
          hx-swap="outerHTML"
          hx-push-url="true"
        >
          Previous
        </a>
      {{else}}
        <span
          class="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-md cursor-not-allowed"
        >
          Previous
        </span>
      {{/if}}
    </div>

    <span class="text-sm text-gray-700 dark:text-gray-300">
      Page
      {{pagination.currentPage}}
      of
      {{pagination.totalPages}}
    </span>

    <div>
      {{#if pagination.hasMore}}
        <a
          href="/dashboard/{{serviceName}}?page={{add
            pagination.currentPage
            1
          }}"
          class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          hx-get="/dashboard/{{serviceName}}?page={{add
            pagination.currentPage
            1
          }}"
          hx-target="#build-table"
          hx-swap="outerHTML"
          hx-push-url="true"
        >
          Next
        </a>
      {{else}}
        <span
          class="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-md cursor-not-allowed"
        >
          Next
        </span>
      {{/if}}
    </div>
  </div>
{{/if}}
```

### HTMX Infinite Scroll (Optional - Task 1.4)

```handlebars
{{!-- Source: HTMX official examples (https://htmx.org/examples/infinite-scroll/) --}}
<tbody id="build-table-body">
  {{#each builds as |build|}}
    {{> buildRow build=build}}
  {{/each}}

  {{#if pagination.hasMore}}
  {{!-- Trigger row loads next page when scrolled into view --}}
  <tr hx-get="/dashboard/{{serviceName}}?page={{add pagination.currentPage 1}}"
      hx-trigger="revealed"
      hx-swap="beforebegin"
      hx-select="tbody > tr">
    <td colspan="{{add environments.length 1}}" class="text-center py-4 text-gray-500">
      <div class="animate-pulse">Loading more builds...</div>
    </td>
  </tr>
  {{/if}}
</tbody>
```

### Vitest Unit Test (Behavior-Focused)

```typescript
// Source: Existing buildRepository.test.ts patterns + TDD guidelines from CLAUDE.md
describe("findPaginated", () => {
  it("should return first page of builds sorted by newest first", async () => {
    // Given: 25 builds exist with staggered timestamps
    for (let i = 0; i < 25; i++) {
      await repo.create({ accountId, serviceId, buildId: `build-${i}` });
      await new Promise((r) => setTimeout(r, 10)); // Ensure distinct timestamps
    }

    // When: I request page 1 with limit 10
    const result = await repo.findPaginated(accountId, serviceId, 1, 10);

    // Then: I get newest 10 builds
    expect(result.builds).toHaveLength(10);
    expect(result.builds[0].buildId).toBe("build-24"); // Newest
    expect(result.total).toBe(25);
    expect(result.hasMore).toBe(true);
  });

  it("should enforce tenant isolation in pagination", async () => {
    // Given: builds exist for two different accounts
    const accountA = new ObjectId();
    const accountB = new ObjectId();

    for (let i = 0; i < 15; i++) {
      await repo.create({ accountId: accountA, serviceId, buildId: `a-${i}` });
    }
    for (let i = 0; i < 10; i++) {
      await repo.create({ accountId: accountB, serviceId, buildId: `b-${i}` });
    }

    // When: account A requests page 1
    const result = await repo.findPaginated(accountA, serviceId, 1, 10);

    // Then: only account A's builds are returned
    expect(result.total).toBe(15);
    expect(result.builds.every((b) => b.accountId.equals(accountA))).toBe(true);
  });

  it("should handle page beyond total gracefully", async () => {
    // Given: only 5 builds exist
    for (let i = 0; i < 5; i++) {
      await repo.create({ accountId, serviceId, buildId: `build-${i}` });
    }

    // When: I request page 10 with limit 10
    const result = await repo.findPaginated(accountId, serviceId, 10, 10);

    // Then: empty results with correct metadata
    expect(result.builds).toHaveLength(0);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(false);
  });
});
```

### Playwright E2E Test (Task 1.3)

```typescript
// Source: Existing e2e/dashboard.spec.ts patterns
test.describe("Pagination UI", () => {
  test("next button loads second page of builds", async ({ page }) => {
    // Given: authenticated user with 25 builds
    await authenticateTestUser(page, TEST_USERS.userWithManyBuilds);
    await page.goto("/dashboard/test-service");

    // Then: first page shows builds 1-20
    await expect(page.locator("#build-table tbody tr")).toHaveCount(20);

    // When: I click Next
    await page.getByRole("link", { name: "Next" }).click();

    // Then: page 2 loads with builds 21-25
    await expect(page).toHaveURL("/dashboard/test-service?page=2");
    await expect(page.locator("#build-table tbody tr")).toHaveCount(5);
  });

  test("previous button is disabled on first page", async ({ page }) => {
    await authenticateTestUser(page, TEST_USERS.userWithManyBuilds);
    await page.goto("/dashboard/test-service");

    // Previous button should be visible but disabled/non-clickable
    const prevButton = page.getByText("Previous");
    await expect(prevButton).toBeVisible();
    await expect(prevButton).toHaveClass(/cursor-not-allowed/);
  });
});
```

## State of the Art

| Old Approach                          | Current Approach                                     | When Changed                  | Impact                                           |
| ------------------------------------- | ---------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| Load all builds, paginate in memory   | Database-level pagination with skip/limit or cursors | Industry standard since ~2015 | Prevents OOM errors, enables large datasets      |
| Custom JavaScript for infinite scroll | HTMX hx-trigger="revealed" pattern                   | HTMX 1.0+ (2021)              | Zero custom JS needed, more maintainable         |
| Manual query parameter parsing        | Framework-level schema validation                    | Fastify 3.0+ (2020)           | Type safety, automatic coercion, less bugs       |
| Offset pagination everywhere          | Cursor-based for large/real-time datasets            | MongoDB best practices ~2018  | Better performance at scale, consistent ordering |

**Deprecated/outdated:**

- **Loading all documents and slicing:** Causes OOM with large datasets, no longer acceptable
- **Pagination without indexes:** MongoDB requires indexed sort fields for performant pagination
- **Ignoring race conditions in real-time apps:** Offset pagination has consistency issues with live data (accept for Phase 1, plan migration)

## Open Questions

1. **What page size should we use?**

   - What we know: Industry standards are 10-50 items per page. Current implementation loads all builds (no limit).
   - What's unclear: User preference, performance sweet spot for this specific app
   - Recommendation: Start with 20 per page (GitHub's default), make configurable later if needed

2. **Should we implement cursor-based pagination now?**

   - What we know: Better performance for large datasets (>10k), but more complex. Skip/limit adequate for <10k builds.
   - What's unclear: How quickly will users accumulate 10k+ builds per service?
   - Recommendation: Use skip/limit for Phase 1 with performance monitoring. Design repository interface to allow cursor migration without breaking changes.

3. **Do we need page number buttons (1, 2, 3...) or just prev/next?**

   - What we know: Page numbers allow jumping to arbitrary pages. Infinite scroll eliminates need for page numbers.
   - What's unclear: User preference, whether both patterns will coexist
   - Recommendation: Task 1.3 specifies "pagination UI (prev/next, page numbers)", implement both. Task 1.4 adds infinite scroll as optional alternative.

4. **Should pagination state persist in URL?**

   - What we know: HTMX supports hx-push-url="true" to update browser history
   - What's unclear: Whether users need bookmarkable page URLs
   - Recommendation: Yes, use hx-push-url="true" so users can bookmark/share specific pages. No extra work needed, just add HTMX attribute.

5. **Do we need Handlebars helper functions for pagination math?**
   - What we know: Templates need {{add pagination.currentPage 1}} and {{subtract pagination.currentPage 1}}
   - What's unclear: Whether Handlebars has built-in helpers or we need custom ones
   - Recommendation: Register custom Handlebars helpers for add/subtract in server setup (common pattern, 5 lines of code).

## Sources

### Primary (HIGH confidence)

- MongoDB Node.js driver 6.5.0 official docs - cursor.skip(), cursor.limit(), countDocuments()
- Fastify v4 validation documentation - https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- HTMX official examples - https://htmx.org/examples/infinite-scroll/
- Existing codebase patterns - buildRepository.ts (ensureIndexes, find queries), dashboard routes (query parameters), e2e tests

### Secondary (MEDIUM confidence)

- [MongoDB Pagination - Skip is Slow](https://arpitbhayani.me/blogs/mongodb-cursor-skip-is-slow/) - Performance analysis
- [MongoDB Pagination - Two Approaches You Need to Know](https://arpitbhayani.me/blogs/fast-and-efficient-pagination-in-mongodb/) - Skip/limit vs cursor comparison
- [Optimize MongoDB® Pagination | ScaleGrid](https://scalegrid.io/blog/mongodb-pagination/) - Best practices and indexing
- [A deep dive into cursor-based pagination in MongoDB](https://engage.so/blog/a-deep-dive-into-offset-and-cursor-based-pagination-in-mongodb/) - Detailed cursor pagination guide
- [MongoDB Pagination, Fast & Consistent | Medium](https://medium.com/swlh/mongodb-pagination-fast-consistent-ece2a97070f3) - Consistency considerations
- [Efficient Data Pagination in MongoDB with Skip, Limit, and Cursor | Medium](https://medium.com/@louistrinh/efficient-data-pagination-in-mongodb-with-skip-limit-and-cursor-14968b132b4f) - Comparison
- [HTMX Infinite Scroll Tutorial | Wawandco](https://wawand.co/blog/posts/infinite-scroll-with-go-and-htmx/) - Implementation guide
- [Infinite scrolling with HTMX - JetBrains Guide](https://www.jetbrains.com/guide/dotnet/tutorials/htmx-aspnetcore/infinite-scrolling/) - .NET example
- [Handlebars pagination helpers](https://github.com/olalonde/handlebars-paginate) - UI helper library (not using, but validates pattern)
- [Ghost Handlebars Theme Helpers: pagination](https://ghost.org/docs/themes/helpers/pagination/) - Production pagination helper API

### Tertiary (LOW confidence)

- WebSearch results about MongoDB cursor pagination 2026 - General patterns, not version-specific
- WebSearch results about Fastify query validation 2026 - Confirmed official docs, no new info

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - All libraries already in package.json, versions verified
- Architecture: HIGH - Patterns match existing codebase conventions (repositories, services, routes, tests)
- Pitfalls: MEDIUM-HIGH - Based on official docs + multiple verified sources, but some specific to skip/limit approach
- Code examples: HIGH - Derived from official docs and existing codebase patterns
- Performance characteristics: MEDIUM - Based on MongoDB docs and multiple blog posts, but not benchmarked for this specific app

**Research date:** 2026-02-08
**Valid until:** ~2026-03-08 (30 days - stable domain, no fast-moving libraries)

**Notes:**

- No CONTEXT.md exists, so no locked user decisions to constrain research
- Recommended skip/limit for Phase 1 based on simplicity + adequacy for stated 1000+ build target
- Documented migration path to cursor-based pagination if dataset grows beyond 10k builds
- All patterns verified against existing codebase conventions (TDD, tenant isolation, HTMX usage)
