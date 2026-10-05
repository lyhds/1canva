/**
 * Delivery estimate timeline: date ranges are computed client-side from
 * data-delivery-range="min,max" day offsets, so cached pages always show the
 * estimate relative to the viewing date instead of the render date.
 */
window.theme = window.theme || {};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function rangeLabel(minDays, maxDays) {
  const from = new Date();
  const to = new Date();
  from.setDate(from.getDate() + minDays);
  to.setDate(to.getDate() + maxDays);
  // same-month ranges collapse the month, e.g. "Sep 20–27" (matches %b %-d)
  return from.getMonth() === to.getMonth()
    ? `${formatDate(from)}–${to.getDate()}`
    : `${formatDate(from)}–${formatDate(to)}`;
}

function renderDeliveryRanges(root = document) {
  root.querySelectorAll("[data-delivery-range]").forEach((el) => {
    const [min, max] = el.dataset.deliveryRange.split(",").map((n) => Number.parseInt(n, 10));
    if (Number.isFinite(min) && Number.isFinite(max)) el.textContent = rangeLabel(min, max);
  });
}

window.theme.renderDeliveryRanges = renderDeliveryRanges;
renderDeliveryRanges();
