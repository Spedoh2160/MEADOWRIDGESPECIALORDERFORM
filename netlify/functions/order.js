const nodemailer = require("nodemailer");

const isEmail = (s) => /^\S+@\S+\.\S+$/.test(s);

function validatePayload(p) {
  if (!p || typeof p !== "object") return "Invalid payload.";
  const c = p.customer || {};
  if (!c.name) return "Customer name is required.";
  if (!c.email || !isEmail(c.email)) return "Valid email is required.";
  if (!Array.isArray(p.items) || p.items.length === 0) return "At least one item required.";
  if (p.items.some(i => !i.name || typeof i.unitPrice !== "number" || i.unitPrice < 0 || !Number.isFinite(i.quantity) || i.quantity <= 0))
    return "Invalid item data.";
  const tp = p.totals?.taxPercent;
  if (typeof tp !== "number" || tp < 0 || tp > 100) return "Invalid tax percent.";
  return null;
}

function isGiftCard(name) {
  return /gift\s*card/i.test(name || "");
}

function recomputeTotals(items, taxPercent) {
  const subtotal = items.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
  const taxableSubtotal = items.reduce((s, i) => s + (isGiftCard(i.name) ? 0 : (i.unitPrice * i.quantity)), 0);
  const taxAmount = taxableSubtotal * (taxPercent / 100);
  const grandTotal = subtotal + taxAmount;
  return { subtotal, taxAmount, grandTotal };
}

const currency = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function renderMerchantHTML(payload, totals) {
  const rows = payload.items.map(i => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${currency(i.unitPrice)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${currency(i.unitPrice * i.quantity)}</td>
    </tr>
  `).join("");

  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial;">
    <h2 style="margin:0 0 6px;">New Order</h2>
    <p style="margin:0 0 16px;color:#555;">Submitted on ${new Date().toLocaleString()}</p>

    <h3 style="margin:0 0 6px;">Customer</h3>
    <div style="margin:0 0 16px;">
      <div><strong>Name:</strong> ${payload.customer.name}</div>
      <div><strong>Email:</strong> ${payload.customer.email}</div>
      ${payload.customer.phone ? `<div><strong>Phone:</strong> ${payload.customer.phone}</div>` : ""}
      ${payload.customer.address ? `<div><strong>Address:</strong> ${payload.customer.address}</div>` : ""}
      ${payload.customer.orderDate ? `<div><strong>Order Date:</strong> ${payload.customer.orderDate}</div>` : ""}
    </div>

    <h3 style="margin:0 0 6px;">Items</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;">
      <thead>
        <tr>
          <th align="left" style="padding:8px;border-bottom:2px solid #333;">Item</th>
          <th align="left" style="padding:8px;border-bottom:2px solid #333;">Unit Price</th>
          <th align="left" style="padding:8px;border-bottom:2px solid #333;">Qty</th>
          <th align="left" style="padding:8px;border-bottom:2px solid #333;">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="3" align="right" style="padding:8px;">Subtotal</td><td style="padding:8px;">${currency(totals.subtotal)}</td></tr>
        <tr><td colspan="3" align="right" style="padding:8px;">Tax (${(Number(payload.totals.taxPercent) || 0).toFixed(2)}%)</td><td style="padding:8px;">${currency(totals.taxAmount)}</td></tr>
        <tr><td colspan="3" align="right" style="padding:8px;"><strong>Grand Total</strong></td><td style="padding:8px;"><strong>${currency(totals.grandTotal)}</strong></td></tr>
      </tfoot>
    </table>
  </div>`;
}

function renderMerchantText(payload, totals) {
  return [
    `New Order`,
    `Customer: ${payload.customer.name}`,
    `Email: ${payload.customer.email}`,
    payload.customer.phone ? `Phone: ${payload.customer.phone}` : "",
    payload.customer.address ? `Address: ${payload.customer.address}` : "",
    payload.customer.orderDate ? `Order Date: ${payload.customer.orderDate}` : "",
    ``,
    ...payload.items.map(i => `- ${i.name} x${i.quantity} @ ${currency(i.unitPrice)} = ${currency(i.unitPrice * i.quantity)}`),
    ``,
    `Subtotal: ${currency(totals.subtotal)}`,
    `Tax (${payload.totals.taxPercent}%): ${currency(totals.taxAmount)}`,
    `Grand Total: ${currency(totals.grandTotal)}`
  ].filter(Boolean).join("\n");
}

function renderCustomerHTML(payload, totals, brand, supportEmail, supportPhone) {
  const rows = payload.items.map(i => `
    <tr>
      <td style="padding:8px 0;">${i.name}</td>
      <td style="padding:8px 0;" align="right">${i.quantity} × ${currency(i.unitPrice)}</td>
      <td style="padding:8px 0;" align="right"><strong>${currency(i.unitPrice * i.quantity)}</strong></td>
    </tr>
  `).join("");

  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial; color:#111; max-width:720px; margin:0 auto;">
    <div style="padding:16px 0;">
      <h2 style="margin:0 0 8px;">Thank you for your order, ${payload.customer.name}! 🐾</h2>
      <p style="margin:0 0 12px; color:#374151;">
        We’ve received your request and will reach out shortly to answer any questions and collect payment.
      </p>
      <p style="margin:0 0 16px; color:#374151;">
        If you need anything in the meantime, reply to this email${supportEmail ? ` at <strong>${supportEmail}</strong>` : ""}${supportPhone ? ` or call <strong>${supportPhone}</strong>` : ""}.
      </p>
    </div>

    <div style="border:1px solid #e5e7eb; border-radius:12px; padding:16px;">
      <h3 style="margin:0 0 12px;">Order Summary</h3>
      <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 0; border-bottom:1px solid #e5e7eb;">Item</th>
            <th align="right" style="padding:8px 0; border-bottom:1px solid #e5e7eb;">Qty × Price</th>
            <th align="right" style="padding:8px 0; border-bottom:1px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td></td>
            <td align="right" style="padding-top:10px;">Subtotal</td>
            <td align="right" style="padding-top:10px;">${currency(totals.subtotal)}</td>
          </tr>
          <tr>
            <td></td>
            <td align="right">Tax (${payload.totals.taxPercent}%)</td>
            <td align="right">${currency(totals.taxAmount)}</td>
          </tr>
          <tr>
            <td></td>
            <td align="right"><strong>Grand Total</strong></td>
            <td align="right"><strong>${currency(totals.grandTotal)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p style="margin:16px 0 0; color:#6b7280;">
      ${brand ? brand : "Our team"} will follow up soon. Thanks again!
    </p>
  </div>`;
}

function renderCustomerText(payload, totals, brand, supportEmail, supportPhone) {
  return [
    `Thank you for your order, ${payload.customer.name}!`,
    `We’ve received your request and will contact you soon to answer any questions and collect payment.`,
    supportEmail || supportPhone ? `Contact: ${[supportEmail, supportPhone].filter(Boolean).join(" | ")}` : "",
    ``,
    `Order Summary`,
    ...payload.items.map(i => `- ${i.name}: ${i.quantity} × ${currency(i.unitPrice)} = ${currency(i.unitPrice * i.quantity)}`),
    ``,
    `Subtotal: ${currency(totals.subtotal)}`,
    `Tax (${payload.totals.taxPercent}%): ${currency(totals.taxAmount)}`,
    `Grand Total: ${currency(totals.grandTotal)}`,
    ``,
    `${brand ? brand : "Our team"} will follow up shortly.`
  ].filter(Boolean).join("\n");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const err = validatePayload(payload);
    if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };

    const totals = recomputeTotals(payload.items, payload.totals.taxPercent);

    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      TO_EMAIL,
      FROM_EMAIL,
      BRAND_NAME,
      SUPPORT_EMAIL,
      SUPPORT_PHONE,
      SEND_CUSTOMER_CONFIRMATION
    } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !TO_EMAIL) {
      return { statusCode: 500, body: JSON.stringify({ error: "Email service not configured." }) };
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const subjCore = `Order — ${currency(totals.grandTotal)}`;
    const merchantSubject = `New Order from ${payload.customer.name} — ${subjCore}`;
    const merchantHTML = renderMerchantHTML(payload, totals);
    const merchantText = renderMerchantText(payload, totals);

    // Send to merchant
    await transporter.sendMail({
      from: FROM_EMAIL || SMTP_USER,
      to: TO_EMAIL,
      subject: merchantSubject,
      text: merchantText,
      html: merchantHTML,
      replyTo: payload.customer.email
    });

    // Send confirmation to customer
    const allowCustomer = String(SEND_CUSTOMER_CONFIRMATION || "true").toLowerCase() === "true";
    if (allowCustomer && payload.customer.email) {
      const brand = BRAND_NAME || "";
      const customerSubject = `Thanks for your order — ${brand || "Thank you"} (${subjCore})`;
      const customerHTML = renderCustomerHTML(payload, totals, brand, SUPPORT_EMAIL || "", SUPPORT_PHONE || "");
      const customerText = renderCustomerText(payload, totals, brand, SUPPORT_EMAIL || "", SUPPORT_PHONE || "");

      await transporter.sendMail({
        from: FROM_EMAIL || SMTP_USER,
        to: payload.customer.email,
        subject: customerSubject,
        text: customerText,
        html: customerHTML,
        replyTo: TO_EMAIL
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error." }) };
  }
};