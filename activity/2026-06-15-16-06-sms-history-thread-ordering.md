# SMS History Thread Ordering

Roborev 134 found that candidate selection inside a single SMS thread still
sorted by normalized seconds, so two same-second messages could be chosen by API
array order. Per-thread candidate ordering now uses the raw timestamp precision
used by the global candidate comparison.

The regression covers one thread returning same-second messages in older-first
order. Version files were bumped to 1.5.13 for the follow-up.
