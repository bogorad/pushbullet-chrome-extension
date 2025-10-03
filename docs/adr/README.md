# Architectural Decision Records (ADRs)

## What is an ADR?

An Architectural Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

## Why do we use ADRs?

- **Knowledge Sharing**: Prevents having to re-explain decisions over and over
- **Future-Proofing**: When someone wants to change something, they can read the ADR to understand the original context
- **Team Collaboration**: Helps new team members understand why the code is structured the way it is
- **Historical Context**: Provides a timeline of architectural evolution

## ADR Format

Each ADR follows this structure:

```markdown
# ADR XXXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?
```

## ADR Index

- [ADR 0001: Initialization Race Condition](./0001-initialization-race-condition.md) - Promise Singleton Pattern
- [ADR 0002: Storage Repository Pattern](./0002-storage-repository-pattern.md) - Abstracting chrome.storage
- [ADR 0003: Event Bus Pattern](./0003-event-bus-pattern.md) - Decoupling components
- [ADR 0004: API Centralization](./0004-api-centralization.md) - Dumb Client Pattern
- [ADR 0005: Service Worker State Machine](./0005-service-worker-state-machine.md) - Centralized Lifecycle Management

## Creating a New ADR

1. Copy the template from `template.md`
2. Number it sequentially (e.g., `0005-my-decision.md`)
3. Fill in the sections
4. Add it to the index above
5. Commit it with your code changes

## References

- [ADR GitHub Organization](https://adr.github.io/)
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

