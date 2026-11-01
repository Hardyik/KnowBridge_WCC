# Payments Platform — Gateway Migration (demo repo)

Synthetic demo repository for KnowBridge judging. Everything here is fictional.

> **Status: the transaction routing service migration is still incomplete; sandbox rollout is pending and the TF-Bridge decommission has not started. See issue #12 for the current gap list.**

This repo needs a new owner — the last senior maintainer left in April.

## Quick links

- [ADR-001: Stripe-adapter microservice](docs/adr-001-transaction-routing.md)
- [CONTRIBUTING](CONTRIBUTING.md)
- Open issues: #12 (routing rollout), #7 (webhook duplicate refunds), #15 (reconciliation inventory)

## Recent decisions recorded in ADRs

- ADR-001 adopts the Stripe-adapter microservice, chosen because direct SDK
  integration tied core payments flows to one vendor's client library lifetime.
- The refund reconciliation path stays intact through the cut-over.
