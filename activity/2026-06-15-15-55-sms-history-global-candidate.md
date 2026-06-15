# SMS History Global Candidate

Roborev 132 found that returning the first thread with a correlated SMS could
still show the wrong sender when multiple active threads had recent messages.
SMS-history fallback now evaluates displayable candidates across all fetched
recent threads and selects the newest message at or before the tickle timestamp.

The regression covers competing active threads where the first fetched thread has
an older unrelated SMS and the real thread has the newer valid SMS. Version files
were bumped to 1.5.11 for the follow-up.
