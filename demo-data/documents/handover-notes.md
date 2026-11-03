# Ledgerline payments migration — handover notes

## Overview
Ledgerline is the checkout and settlement service for our merchant portal. The team is
replacing the legacy transaction processor with a set of Node services. At the time of
writing, the migration is roughly 70 percent complete: card payments run on the new
pathway, bank transfer settlement is still on the legacy system.

## Current phase
The project is in a controlled pilot with three merchants. We have not announced a
general availability date. Priya Raman owns the pilot rollout and reports weekly.

## Decisions
We replaced vendor session cookies with short lived JWT access tokens so the mobile app
can authenticate without a server session. The reasoning was that the Flutter client
could not reliably persist cookies across app restarts.

We decided to keep the reconciliation report generation in the legacy PHP service for
this phase. Rewriting it would have delayed the pilot by an estimated six weeks.

We chose to store merchant settlement exports on the application server instead of the
old managed object store, because the procurement review for the managed store had not
finished.

## Completed work
The chargeback webhook handler is deployed and processing production traffic. Merchant
onboarding now goes through the new admin API. The OpenAPI contract for the payment
initiation endpoint is published and pinned in the client SDK.

## Pending work
Bank transfer settlement still routes through the legacy processor. The merchant
self-service screen for settlement exports is not started. Rate limiting on the public
payment endpoints is configured but not load tested.

## Ownership
Dana Okafor owns the settlement migration and the vendor relationship.
Priya Raman owns the pilot rollout and merchant communications.
Tomas Berg owns the reconciliation service and the legacy PHP integration.

## Next actions
Book a joint session with the vendor to confirm the sandbox cutover date.
Add an alert when chargeback webhook failures exceed one percent over ten minutes.
Publish the settlement export screen design for review before implementation starts.

## Open questions
Do we keep the legacy processor licenced past December, or pay for early termination?
Who signs off on the merchant data retention window that the exports now follow?
