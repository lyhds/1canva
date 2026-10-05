/**
 * Announcement bar: fades between message blocks every 5 seconds.
 * Bars with a single message stay static.
 */
document.querySelectorAll("[data-announcement]").forEach((bar) => {
  if (bar.dataset.announcementInitialized) return;
  bar.dataset.announcementInitialized = "true";
  const messages = bar.querySelectorAll("[data-announcement-message]");
  if (messages.length < 2) return;

  let index = 0;
  const timer = setInterval(() => {
    if (!bar.isConnected) {
      clearInterval(timer);
      return;
    }
    // Do not move a link out from under a keyboard user.
    if (bar.contains(document.activeElement)) return;
    const next = (index + 1) % messages.length;
    messages[index].classList.remove("opacity-100");
    messages[index].classList.add("opacity-0");
    messages[index].classList.add("pointer-events-none");
    messages[index].setAttribute("aria-hidden", "true");
    messages[index].inert = true;
    messages[next].classList.remove("opacity-0");
    messages[next].classList.add("opacity-100");
    messages[next].classList.remove("pointer-events-none");
    messages[next].removeAttribute("aria-hidden");
    messages[next].inert = false;
    index = next;
  }, 5000);
});
