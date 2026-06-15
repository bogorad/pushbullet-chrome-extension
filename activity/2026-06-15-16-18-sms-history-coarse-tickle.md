# SMS History Coarse Tickle

Roborev 136 found that raw millisecond cutoffs were too strict when a
`sms_changed` tickle only carried second-level precision. Raw cutoff enforcement
now applies only when the selected tickle timestamp itself has sub-second
precision; coarse tickles continue to use second-level correlation.

The regression covers a second-precision tickle resolving a same-second
millisecond SMS. Version files were bumped to 1.5.15, and the local ignored
`package-lock.json` was refreshed to match that version.
