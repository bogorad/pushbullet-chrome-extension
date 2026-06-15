# SMS History Future Match

Roborev 130 found that SMS-history fallback still allowed messages after the
`sms_changed` tickle when resolving empty SMS notifications. The correlation now
accepts only history messages at or before the tickle timestamp, keeping the
existing five-minute lookback for delayed history availability.

The regression now covers an unrelated SMS arriving five seconds after the
tickle. Version files were bumped to 1.5.9 for the change.
