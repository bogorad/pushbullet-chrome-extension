# SMS History Active Thread

Roborev 131 found that rejecting threads whose latest SMS was newer than the
`sms_changed` tickle could hide the correct earlier message in the same active
thread. Thread selection now keeps active recent threads in the candidate set,
and message selection chooses only the newest message within the lookback that is
at or before the tickle timestamp.

The regression covers a thread with a newer unrelated latest SMS and an earlier
matching SMS. Version files were bumped to 1.5.10 for the follow-up.
