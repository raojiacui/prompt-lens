# Manual refund review

V2 customer requests no longer call the Alipay refund gateway. Customers submit
an order-specific reason and contact details, then contact support on WeChat
13117177652. Partnership inquiries go to 489543971@qq.com.

The current request form handles unused whole packages only. Used packages,
pending tasks and delivered link imports require direct support review; there
is no newly enabled partial refund path. This restriction is not a promise
that those requests will be refused by customer support.

The request atomically pauses that purchase's benefits and records `requested`.
At /billing/review, an authenticated administrator must confirm customer contact
and enter review evidence. Approval additionally requires explicit full-amount
confirmation, both in the UI and server route. It persists `processing` before
calling Alipay. Repeated or concurrent approval cannot submit a second refund.

Rejection restores package benefits atomically, retaining the reviewer's identity
and evidence. The existing database `failed` state with `decision: reject` stores
this outcome; the customer account API displays it as `rejected`. No database
migration is needed. Successful refunds retain contact and approval evidence.

A timeout or uncertain gateway outcome stays in `review`, with benefits paused.
Neither approval nor rejection can be repeated for that state: first reconcile
the real Alipay merchant records. Never interpret a timeout as proof of failure
or restore benefits while an actual refund might have succeeded.

This change is local V2 code until pushed and deployed. No production payments
or database changes are performed by the automated verification tests.
