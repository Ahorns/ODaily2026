function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function onRequest(context) {
  const configured = String(context.env.WRITER_EMAIL || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!configured.length) {
    return json({ error: "WRITER_EMAIL is not configured." }, 503);
  }

  const email = String(
    context.request.headers.get("Cf-Access-Authenticated-User-Email") || "",
  ).toLowerCase();

  if (!email) {
    return json({ error: "Please sign in through Cloudflare Access." }, 401);
  }

  if (!configured.includes(email)) {
    return json({ error: "This account is not allowed to edit ODaily." }, 403);
  }

  context.data.writerEmail = email;
  return context.next();
}
