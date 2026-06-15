# SMS History Raw Tickle Bound

Roborev 135 found that same-second ordering could admit a message that arrived
after the raw `sms_changed` tickle timestamp. The fallback now keeps a raw-order
timestamp for the tickle and rejects candidate SMS messages with raw timestamps
greater than that value before ordering candidates.

The regression covers one same-second message just before and one just after the
tickle. Version files were bumped to 1.5.14 for the follow-up.
