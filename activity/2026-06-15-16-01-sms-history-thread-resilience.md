# SMS History Thread Resilience

Roborev 133 found two remaining SMS-history fallback risks: a later thread
failure could discard an already resolved SMS candidate, and same-second
candidate timestamps could tie after normalization. Thread fetch/decrypt failures
are now isolated per thread, preserving the current best candidate, and raw
timestamp precision is retained for candidate ordering.

Regressions cover a later thread lookup failure and millisecond-level ordering
within the same second. Version files were bumped to 1.5.12 for the follow-up.
