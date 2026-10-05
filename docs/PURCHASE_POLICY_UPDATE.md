# Artwork review and cancellation policy update

**Status: approved publication specification — September 5, 2026.**
The merchant authorized publication of these policy updates and the matching
product-page summaries. Shopify policy bodies are store data managed separately
from the theme's GitHub branch; keep both surfaces aligned when updating them.

## Confirmed scope

- Send finished-painting photos; continue revisions until the customer is satisfied.
- Allow 3 days from the first photo email, with 3 emails in total (the initial
  photo email plus 2 reminders). If all remain unanswered, ship as ordered.
- Standard orders may be cancelled before shipment, including during photo review.
- Cancelling custom colours or non-standard sizes before shipment incurs a
  **US$100 materials fee**. Choosing an offered size or frame is not custom work.
- After dispatch, use the existing return process instead of cancellation.
- Keep the existing **14-day** return period, buyer-paid change-of-mind return
  shipping, custom-item exclusions and mandatory consumer-law protections.
  Do not copy MesonArt's 30-day return window or add a money-back guarantee.

Cancellation reference, checked September 5, 2026:
[MesonArt FAQ](https://www.mesonart.com/en-ca/pages/faqs) and
[Returns & Exchanges](https://www.mesonart.com/en-ca/pages/returns-exchanges).
The no-response deadline is the merchant's own rule, not a MesonArt claim.

## Shipping Policy — targeted updates

Add the following after **Estimated delivery time**, before **Order processing
and tracking**. Keep the existing estimate and tracking paragraphs; append
“Photo review and requested revisions may extend this estimate.” to the
estimated-delivery paragraph.

```html
<h2>Artwork photos and pre-shipment review</h2>
<p>Before shipping, we email photos of your finished painting to the address provided at checkout. You may request revisions, and we will continue refining the painting based on your feedback until you are satisfied.</p>
<p>We ship after your approval, or under the no-response process below. The review period is 3 days (72 hours) from the first email containing your finished-painting photos. We send 3 emails in total during this period: the initial photo email and 2 reminders. If all 3 emails remain unanswered at the end of this period, we will ship your artwork as ordered.</p>
<p>A reply stops the no-response dispatch process for that review. If you request changes, we continue revisions rather than shipping while those changes are pending. We send updated photos after the revisions; the same review process then applies to the updated painting.</p>
```

Under **Address changes**, replace the first paragraph's 12-hour limitation
with the following. Preserve the existing paragraph about additional shipping
costs caused by an incorrect or incomplete address.

```html
<p>Review your delivery address carefully at checkout. To request an address change before shipment, email service@canvasra.com as soon as possible. We will do our best to accommodate changes before the parcel is handed to the carrier. Once dispatched, we cannot guarantee address changes or interception.</p>
```

## Return & Refund Policy — targeted update

Replace the paragraphs under **Order cancellations and changes** with the
following. Leave **14-day return window** and every subsequent section intact.

```html
<p>Standard orders can be cancelled before shipment, including during the photo-review stage. To request an order change or cancellation, email service@canvasra.com before the artwork is handed to the carrier.</p>
<p>For custom colours or non-standard sizes, cancellation before shipment incurs a US$100 materials fee, subject to applicable consumer law. This fee does not apply to standard artwork purchased in our listed size and frame options.</p>
<p>Once the artwork has been handed to the carrier, the order cannot be directly cancelled or intercepted. After delivery, any return request is handled under the eligibility rules, 14-day deadline and custom-item exclusions below.</p>
```

## Terms of Service — targeted updates

Under **Orders**, replace only the paragraph beginning “Order cancellation or
change requests must be made within 12 hours” with the following. Preserve the
preceding paragraph about merchant-initiated cancellations and refunds.

```html
<p>Standard orders can be cancelled before shipment, including during photo review. Cancelling custom colours or non-standard sizes before shipment incurs a US$100 materials fee, subject to applicable consumer law. Once dispatched, orders cannot be directly cancelled; the return policy applies. To request an order change or cancellation, email service@canvasra.com. See our <a href="/policies/refund-policy">Return &amp; Refund Policy</a> for details.</p>
```

Under **Shipping, returns, and refunds**, retain the existing policy links and
estimated-delivery wording, and add:

```html
<p>Before shipment, we send finished-painting photos and offer revisions until you are satisfied. We ship after approval, or if all 3 emails remain unanswered after the 3-day review period starting with the first photo email. Replies and requested revisions are handled under the review process in our <a href="/policies/shipping-policy">Shipping Policy</a>. Photo review and revisions may extend the estimated delivery time.</p>
```

## Publication and operational checklist

1. Fetch GitHub again, preserve merchant edits, and re-read all three live policies.
   Apply only the targeted changes above to their latest bodies, never restore a
   full policy from a stale snapshot. Update each policy's “Last updated” date
   to its actual publication date.
2. Publish the policies alongside the corresponding changes in
   `templates/product.json`; do not leave a new PDP summary linked to an old
   12-hour cancellation policy. Preserve all unrelated theme settings and copy.
3. Re-read the exact policy bodies. Verify the 3-day/3-email exception, revisions,
   US$100 custom-only fee, 14-day returns and absence of the obsolete 12-hour
   limit in these updated sections. Check live PDP headings and full body text.
4. Verify the sender and support mailbox work. Treat failed/bounced emails as a
   delivery problem, not customer silence. Record the photo-email time and both
   reminders; dispatch under this rule only after the full 72 hours and all
   three emails, with no reply and no pending revision request.
5. This work changes copy only. It does **not** automate emails, cancel/refund
   orders, deduct fees or mark orders fulfilled. Those actions require the
   merchant's operational process or a separately authorized integration.

Baseline snapshots: `.shopify/backups/20260905T091019Z-purchase-policy-draft/`.
