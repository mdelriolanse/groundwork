async function openBoard(event) {
  const link = event.target.closest("a.demo-now");
  if (!link) return;
  event.preventDefault();
  try {
    await fetch("/api/demo/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch {}
  location.assign(link.href);
}

for (const link of document.querySelectorAll("a.demo-now")) {
  link.addEventListener("click", openBoard);
}
