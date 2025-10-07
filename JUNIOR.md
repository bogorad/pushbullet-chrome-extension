# Instructions for Junior Programmers: Improving Error Handling

## Introduction

This document provides guidance on improving error handling in our codebase, specifically focusing on a common "code smell" known as "redundant catch blocks." As a junior programmer, understanding and implementing robust error handling is crucial for writing reliable and maintainable software.

## What is a "Redundant Catch Block"?

A "redundant catch block" is a `try-catch` statement where the `catch` block either:

1.  **Does nothing useful:** It catches an error but then performs no action, or only a generic comment like `// noop` (no operation) or `// ignore`. This effectively "swallows" the error, making it invisible.
2.  **Performs insufficient handling:** It catches an error but only logs it at a low level, without taking any corrective action, notifying the user, or re-throwing it for higher-level handling.

**Why is this a problem?**

When errors are silently swallowed, it can lead to:

- **Hidden Failures:** You won't know when something goes wrong, making debugging very difficult.
- **Incorrect Application State:** The application might behave unexpectedly because an error prevented a part of the code from executing correctly.
- **Poor User Experience:** Users might encounter issues without any feedback or explanation.
- **Future Bugs:** A small, ignored error today could become a major problem as the codebase evolves.

## Your Task: Improve Error Handling

Your goal is to review existing `try-catch` blocks, especially those with `// noop` or `// ignore` comments, and improve their error handling based on the following strategies.

### Strategy 1: Log with Context

Instead of silently ignoring an error, always log it with enough context to understand what went wrong. Our codebase uses `debugLogger` for this purpose.

**Pseudocode Example (Before):**

```typescript
try {
  // Some operation that might fail
  doSomething();
} catch {
  // noop
}
```

**Pseudocode Example (After):**

```typescript
try {
  // Some operation that might fail
  doSomething();
} catch (error) {
  // Log the error with relevant context
  debugLogger.general(
    "WARN",
    "Failed to do something important",
    {
      contextData: "some value related to the operation",
      errorMessage: (error as Error).message, // Cast to Error to access message property
    },
    error as Error,
  ); // Pass the original error object for stack trace
}
```

**Key Points:**

- Always include the `error` object in the `catch` block so you can access its `message` and `stack` properties.
- Use `debugLogger.general` (or a more specific category like `debugLogger.api`, `debugLogger.storage`, etc.) with an appropriate log level (`WARN` or `ERROR`).
- Provide a clear, descriptive message about what failed.
- Include relevant `data` in the log object that helps pinpoint the issue (e.g., IDs, input values, current state).
- Pass the original `error` object as the last argument to `debugLogger` to ensure the stack trace is captured.

### Strategy 2: Re-evaluate Criticality

For each `catch` block you encounter, ask yourself:

- **Is this error truly ignorable?** What are the consequences if this error occurs?
- **Does it affect core functionality or user experience?**
- **Could it indicate a deeper problem that _should_ be addressed?**
- **Is there any way to recover or provide user feedback?**

If an error is truly non-critical and has no impact on functionality, then logging it as a `WARN` might be sufficient. However, if it affects the user or the application's state, more action is needed.

**Pseudocode Example:**

```typescript
try {
  // Attempt to update a UI element that might not exist yet
  updateOptionalUIElement();
} catch (error) {
  // Re-evaluation: If the UI element is truly optional and its absence is expected sometimes,
  // then a WARN is appropriate. If its absence indicates a bug, it should be an ERROR.
  debugLogger.general(
    "WARN",
    "Optional UI element not found, skipping update",
    {
      elementId: "my-optional-element",
      errorMessage: (error as Error).message,
    },
  );
}
```

### Strategy 3: Conditional Error Handling

Sometimes, an error might be expected in certain scenarios but not others. In such cases, you can implement conditional logic within the `catch` block.

**Pseudocode Example:**

```typescript
try {
  // Attempt to parse user input as JSON
  const data = JSON.parse(userInput);
  processData(data);
} catch (error) {
  if (error instanceof SyntaxError) {
    // Specific handling for invalid JSON input
    debugLogger.general("INFO", "Invalid JSON input from user", {
      input: userInput,
    });
    showUserMessage("Please enter valid JSON.", "error");
  } else {
    // General handling for other unexpected errors
    debugLogger.general(
      "ERROR",
      "Unexpected error during data processing",
      null,
      error as Error,
    );
    showUserMessage("An unexpected error occurred.", "error");
  }
}
```

### Strategy 4: Propagate if Unhandled

If an error cannot be handled locally (e.g., you don't have enough information to recover, or it's a critical error that needs to stop the current operation), re-throw it or propagate it to a higher level.

**Pseudocode Example:**

```typescript
async function fetchData(url: string): Promise<Data> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // If the response is not OK, it's an API error that needs to be handled upstream
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    // Log the error, but re-throw it because this function cannot fully recover
    debugLogger.api(
      "ERROR",
      "Failed to fetch data from API",
      { url },
      error as Error,
    );
    throw error; // Re-throw the error for the caller to handle
  }
}

// In a higher-level function:
async function loadApplicationData(): Promise<void> {
  try {
    const data = await fetchData("https://api.example.com/data");
    // Process data
  } catch (error) {
    // Here, we can decide to show a user-facing error or retry
    debugLogger.general(
      "CRITICAL",
      "Application failed to load essential data",
      null,
      error as Error,
    );
    showUserMessage(
      "Could not load application data. Please try again later.",
      "error",
    );
  }
}
```

**Key Points:**

- `throw error;` will re-throw the original error, preserving its stack trace.
- This allows higher-level functions to decide how to handle critical errors (e.g., display a user-friendly message, trigger a retry mechanism, or transition to an error state).

## Conclusion

By applying these strategies, you will help make our codebase more robust, easier to debug, and more user-friendly. Always think critically about the impact of an error and choose the most appropriate handling strategy. If you are unsure, it's always better to log more information and propagate the error than to silently swallow it.
