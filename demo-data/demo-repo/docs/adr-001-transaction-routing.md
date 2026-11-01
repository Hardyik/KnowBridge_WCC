# ADR-001 — Stripe-adapter microservice for transaction routing

Status: accepted, 2026-03-14

## Context

The legacy transaction-processing service (TF-Bridge) couples routing,
edge-case handling and vendor client lifetime in one process.

## Decision

Introduce a Stripe-adapter microservice that owns vendor communication;
route through it instead of calling the vendor SDK directly from payment flows.

## Rationale

Direct SDK integration tied core payments flows to one vendor's client
library lifetime and offered no control over edge-case handling during
gateway outages (see decisions.pdf, page 1, for the signed-off record).

## Consequences

- Refund reconciliation path must remain intact through the cut-over.
- TF-Bridge decommission happens only after two clean settlement cycles.
- Aarav Mehta handles vendor edge cases (architecture owner per decisions.pdf).
