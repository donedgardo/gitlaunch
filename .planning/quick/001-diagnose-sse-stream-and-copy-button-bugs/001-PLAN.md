---
phase: quick-001
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/templates/services/settings.hbs
  - src/templates/services/created.hbs
  - src/templates/partials/emptyBuilds.hbs
  - src/templates/partials/buildTable.hbs
autonomous: true

must_haves:
  truths:
    - "Copy Service ID button on settings page copies the correct service ID to clipboard"
    - "Copy Service ID button on created page copies the correct service ID to clipboard"
    - "Copy Workflow Code button on settings and created pages copies the workflow snippet to clipboard"
    - "SSE new-build stream reconnects automatically after connection drops"
  artifacts:
    - path: "src/templates/services/settings.hbs"
      provides: "Settings page with valid idPrefix for JS function names"
      contains: 'idPrefix="settings_"'
    - path: "src/templates/services/created.hbs"
      provides: "Created page with valid idPrefix for JS function names"
      contains: 'idPrefix="created_"'
    - path: "src/templates/partials/emptyBuilds.hbs"
      provides: "Empty builds partial with valid idPrefix for JS function names"
      contains: 'idPrefix="empty_"'
    - path: "src/templates/partials/buildTable.hbs"
      provides: "Build table with SSE reconnection logic"
      contains: "new EventSource"
  key_links:
    - from: "src/templates/services/settings.hbs"
      to: "src/templates/partials/githubSecretsSetup.hbs"
      via: "Handlebars partial invocation with idPrefix"
      pattern: 'idPrefix="settings_"'
    - from: "src/templates/services/settings.hbs"
      to: "src/templates/partials/buildReportingInstructions.hbs"
      via: "Handlebars partial invocation with idPrefix"
      pattern: 'idPrefix="settings_"'
    - from: "src/templates/services/created.hbs"
      to: "src/templates/partials/githubSecretsSetup.hbs"
      via: "Handlebars partial invocation with idPrefix"
      pattern: 'idPrefix="created_"'
---

<objective>
Fix two bugs: (1) Copy buttons for Service ID and Workflow Code are broken on settings, created, and empty-builds pages because hyphenated `idPrefix` values produce invalid JavaScript function names. (2) The SSE new-build stream on the dashboard never reconnects after a connection error, causing builds to stop appearing until page refresh.

Purpose: Users cannot copy their Service ID (critical for CI setup) and lose real-time build visibility after transient network issues.
Output: Working copy buttons on all pages, resilient SSE reconnection on dashboard.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/templates/partials/githubSecretsSetup.hbs
@src/templates/partials/buildReportingInstructions.hbs
@src/templates/partials/buildTable.hbs
@src/templates/services/settings.hbs
@src/templates/services/created.hbs
@src/templates/partials/emptyBuilds.hbs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix copy button broken JS function names by replacing hyphenated idPrefix with underscored idPrefix</name>
  <files>
    src/templates/services/settings.hbs
    src/templates/services/created.hbs
    src/templates/partials/emptyBuilds.hbs
  </files>
  <action>
The root cause: Handlebars partials `githubSecretsSetup.hbs` and `buildReportingInstructions.hbs` use `{{idPrefix}}` to generate JavaScript function names like `copy{{idPrefix}}ServiceId()` and `copy{{idPrefix}}WorkflowCode()`. When callers pass `idPrefix="settings-"`, this produces `copysettings-ServiceId()` which is a syntax error (hyphens are invalid in JS identifiers).

Fix all three caller files by replacing hyphens with underscores in the idPrefix value:

1. **`src/templates/services/settings.hbs`** line 126:

   - Change `idPrefix="settings-"` to `idPrefix="settings_"` in the `githubSecretsSetup` partial call
   - Line 129: Change `idPrefix="settings-"` to `idPrefix="settings_"` in the `buildReportingInstructions` partial call

2. **`src/templates/services/created.hbs`** line 65:

   - Change `idPrefix="created-"` to `idPrefix="created_"` in the `githubSecretsSetup` partial call
   - Line 68: Change `idPrefix="created-"` to `idPrefix="created_"` in the `buildReportingInstructions` partial call

3. **`src/templates/partials/emptyBuilds.hbs`** line 19:
   - Change `idPrefix="empty-"` to `idPrefix="empty_"` in the `githubSecretsSetup` partial call
   - Line 22: Change `idPrefix="empty-"` to `idPrefix="empty_"` in the `buildReportingInstructions` partial call

Do NOT modify `githubSecretsSetup.hbs` or `buildReportingInstructions.hbs` themselves -- the template logic is fine, it is the caller-supplied values that are the problem.

This produces valid function names: `copysettings_ServiceId()`, `copycreated_WorkflowCode()`, etc. Element IDs become `settings_service-id` (underscores are valid in HTML IDs, just like hyphens).
</action>
<verify>
Run `yarn build` to confirm no build errors. Then manually grep the changed files to confirm no remaining `idPrefix="...-"` patterns with hyphens:

```bash
grep 'idPrefix="[^"]*-"' src/templates/services/settings.hbs src/templates/services/created.hbs src/templates/partials/emptyBuilds.hbs
```

This should return zero matches. Also verify the new values are present:

```bash
grep 'idPrefix="settings_"' src/templates/services/settings.hbs
grep 'idPrefix="created_"' src/templates/services/created.hbs
grep 'idPrefix="empty_"' src/templates/partials/emptyBuilds.hbs
```

Each should return matches.
</verify>
<done>
All `idPrefix` values passed to `githubSecretsSetup` and `buildReportingInstructions` partials use underscores instead of hyphens, producing valid JavaScript function names. The copy buttons for Service ID and Workflow Code work without JS syntax errors on the settings, created, and empty-builds pages.
</done>
</task>

<task type="auto">
  <name>Task 2: Fix SSE new-build stream to reconnect after connection errors</name>
  <files>
    src/templates/partials/buildTable.hbs
  </files>
  <action>
The current SSE error handler in `buildTable.hbs` (lines 48-53) closes the EventSource after 5 seconds on error but never creates a new one, so the stream is permanently lost after any transient error.

Replace the SSE `onerror` handler and surrounding IIFE in `buildTable.hbs` (lines 27-59) with a reconnecting pattern:

```javascript
<script>
(function() {
  var serviceName = '{{serviceName}}';
  var eventSource;
  var reconnectDelay = 1000;
  var maxReconnectDelay = 30000;

  function connect() {
    eventSource = new EventSource('/new-build-stream/' + serviceName);

    eventSource.addEventListener('new-build', function(e) {
      reconnectDelay = 1000; // Reset delay on successful message
      var data = JSON.parse(e.data);
      var tbody = document.getElementById('build-table-body');
      if (tbody && data.html) {
        var existingRow = document.getElementById('build-' + data.buildId);
        if (!existingRow) {
          tbody.insertAdjacentHTML('afterbegin', data.html);
          if (typeof htmx !== 'undefined') {
            htmx.process(tbody.firstElementChild);
          }
        }
      }
    });

    eventSource.addEventListener('connected', function() {
      reconnectDelay = 1000; // Reset delay on successful connection
    });

    eventSource.onerror = function() {
      eventSource.close();
      setTimeout(function() {
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        connect();
      }, reconnectDelay);
    };
  }

  connect();

  window.addEventListener('beforeunload', function() {
    if (eventSource) {
      eventSource.close();
    }
  });
})();
</script>
```

Key behaviors:

- On error, close the current connection and reconnect after a delay
- Use exponential backoff: starts at 1s, doubles each retry, caps at 30s
- Reset the delay back to 1s on successful connection or message receipt
- Listen for the `connected` event that the server already sends to confirm connection
- Clean up on page unload as before
  </action>
  <verify>
  Run `yarn build` to confirm no build errors. Read the modified `buildTable.hbs` and confirm:

1. The `onerror` handler calls `connect()` after a timeout (reconnection)
2. `reconnectDelay` doubles on each error (exponential backoff)
3. `reconnectDelay` resets to 1000 on `connected` event and on `new-build` event
4. `maxReconnectDelay` caps at 30000ms
5. `beforeunload` listener still closes the connection

Run `yarn test` to confirm existing tests still pass.
</verify>
<done>
The SSE new-build stream on the dashboard automatically reconnects with exponential backoff (1s to 30s) after connection errors. New builds continue to appear in real-time even after transient network interruptions without requiring a page refresh.
</done>
</task>

</tasks>

<verification>
1. `yarn build` succeeds without errors
2. `yarn test` passes all existing tests
3. No hyphenated `idPrefix` values remain in any template caller
4. The `buildTable.hbs` SSE script contains reconnection logic with exponential backoff
5. Manual verification: open settings page in browser, open DevTools console, click "Copy" button for Service ID -- no JS errors, value copied to clipboard
6. Manual verification: open dashboard, kill and restart the server, observe SSE reconnection in Network tab
</verification>

<success_criteria>

- Copy Service ID button works on settings page (no JS syntax error from invalid function name)
- Copy Service ID button works on created page
- Copy Workflow Code button works on settings and created pages
- SSE new-build stream reconnects automatically after connection loss with exponential backoff
- All existing tests pass
  </success_criteria>

<output>
After completion, create `.planning/quick/001-diagnose-sse-stream-and-copy-button-bugs/001-SUMMARY.md`
</output>
