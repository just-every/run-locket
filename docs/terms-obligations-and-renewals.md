Once an agreement is executed, its terms decide what happens next. Nothing drives a deadline until a person confirms it.

## Confirm terms

On the **Terms and obligations** tab, **Propose or correct a term**: end date, effective date, auto-renewal, renewal term, notice period, governing law or payment terms, each with the **Words from the signed clause** (or a **Signed PDF page** when the version has no text). When Locket recorded the execution and the signed PDF has readable text, the words must appear in that signed PDF, so wording changed after approval cannot be cited; a signed PDF without readable text is shown as not checked. The owner, counsel or an approver confirms or rejects each one. Correcting a confirmed term keeps the earlier value in the history.

## Obligations

**Add an obligation** with **What must be done**, the **Responsible person**, when it is **Due** and whether it **Repeats** (monthly, quarterly or annually). Once confirmed, its responsible person or a confirmer marks it done.

## Notice deadlines

With a confirmed end date and notice period, the agreement appears under **Renewals**. Its notice deadline is the end date minus the notice period, at 11:59 pm in the agreement's time zone (Eastern time, ET, unless the agreement was created through the API with another zone), daylight saving time included. The queue is sorted by deadline, shows how many days are left, and marks **Decide soon** within 30 days.

## Decide and give notice

1. **Decision**: the owner or an approver chooses **Renew**, **Renegotiate** or **Terminate**, with an internal note if useful.
2. **Notice**: anyone working the agreement can **Draft a notice** to the counterparty. The owner or an approver then chooses **Approve for sending**; whoever drafted it cannot approve it, unless they are the owner.
3. Review **Download PDF letter** and its recipient before approval. With the installation's Resend sender and authenticated delivery callbacks configured, choose **Send approved PDF by email**. Locket sends those exact bytes to the approved address and keeps the provider message ID. Local/demo email is suppressed, never labeled sent.
4. For mail, courier or another external method, download the PDF and send it yourself, then **Record that it was sent** with method, time and any evidence. Mail/courier records include a tracking number and remain **Sent, delivery unconfirmed** until you **Record delivered evidence** with its time and receipt note.

## Deadline reminders

Locket emails the right person before each notice deadline and obligation due date: by default 90, 60, 30 and 7 days before, at 9:00 am in their time zone (set it under **Activity → Reminder preferences**; until then, the agreement's zone). For a renewal that is the reminder owner from a bulk schedule, else the agreement's responsible person; for an obligation, its owner. The owner changes the days under **Renewals → Deadline reminders**. A person can choose a daily digest (one email a day) and an alternate recipient. If no renewal decision is recorded 30 days before the deadline, the agreement's approver and the owner are emailed. Recording a decision or marking an obligation done stops the reminders. Each reminder appears on the deadline with the mail provider's own events; a bounced reminder is sent once to the alternate recipient (else the responsible person, else the owner). Emails never include titles, counterparties or values, only a link to sign in.

Approval, sending and delivery stay separate. Provider acceptance is not delivery. Signed delivery/bounce events are labeled provider reports; manual carrier receipts are labeled manually recorded. Counsel decides whether the evidence constitutes legally effective notice. An interrupted or uncertain email send never retries automatically: inspect its outcome before preparing another notice.
