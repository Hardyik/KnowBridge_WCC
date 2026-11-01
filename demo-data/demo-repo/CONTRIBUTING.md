# Contributing (demo repo)

Payments Platform team conventions:

1. Every change to transaction flows needs a second engineer's review — the
   routing service reviews were stalling because deep subsystem expertise sat
   with one person (see the Round 1 interview finding).
2. Commits touching gateway credentials must reference the AppSec reviewer.
3. Sandbox test data is generated with `scripts/make_mock_transactions.sh`;
   never replay production settlement data.
