Title: Webhook retries double-count refunds when the adapter acks slowly
State: open
Author: @sofia-l

Body:
When the adapter service is slow to acknowledge, vendor webhook retries make
refund totals double-count. Ops runbook workaround is live (idempotency guard
flags on refund endpoints), but the regression needs a permanent fix in the
refund reconciliation path.
