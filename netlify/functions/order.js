// /netlify/functions/order.js
const nodemailer = require("nodemailer");

const isEmail = (s) => /^\S+@\S+\.\S+$/.test(s);
function validatePayload(p){ if(!p||typeof p!=="object")return"Invalid payload.";
  const c=p.customer||{};
  if(!c.name)return"Customer name is required.";
  if(!c.email||!isEmail(c.email))return"Valid email is required.";
  if(!Array.isArray(p.items)||p.items.length===0)return"At least one item required.";
  if(p.items.some(i=>!i.name||typeof i.unitPrice!=="number"||i.unitPrice<0||!Number.isFinite(i.quantity)||i.quantity<=0))return"Invalid item data.";
  const tp=p.totals?.taxPercent; if(typeof tp!=="number"||tp<0||tp>100)return"Invalid tax percent."; return null;}
function recomputeTotals(items,tax){const sub=items.reduce((s,i)=>s+i.unitPrice*i.quantity,0);const taxAmt=sub*(tax/100);return{subtotal:sub,taxAmount:taxAmt,grandTotal:sub+taxAmt};}
const currency=(n)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
function renderEmailHTML(payload,totals){const rows=payload.items.map(i=>`
<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.name}</td>
<td style="padding:8px;border-bottom:1px solid #eee;">${currency(i.unitPrice)}</td>
<td style="padding:8px;border-bottom:1px solid #eee;">${i.quantity}</td>
<td style="padding:8px;border-bottom:1px solid #eee;">${currency(i.unitPrice*i.quantity)}</td></tr>`).join("");
return `<div style="font-family:system-ui,Segoe UI,Roboto,Arial;">
<h2 style="margin:0 0 6px;">New Order</h2>
<p style="margin:0 0 16px;color:#555;">Submitted on ${new Date().toLocaleString()}</p>
<h3 style="margin:0 0 6px;">Customer</h3>
<div style="margin:0 0 16px;">
<div><strong>Name:</strong> ${payload.customer.name}</div>
<div><strong>Email:</strong> ${payload.customer.email}</div>
${payload.customer.phone?`<div><strong>Phone:</strong> ${payload.customer.phone}</div>`:""}
${payload.customer.address?`<div><strong>Address:</strong> ${payload.customer.address}</div>`:""}
${payload.customer.orderDate?`<div><strong>Order Date:</strong> ${payload.customer.orderDate}</div>`:""}
</div>
<h3 style="margin:0 0 6px;">Items</h3>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;">
<thead><tr><th align="left" style="padding:8px;border-bottom:2px solid #333;">Item</th>
<th align="left" style="padding:8px;border-bottom:2px solid #333;">Unit Price</th>
<th align="left" style="padding:8px;border-bottom:2px solid #333;">Qty</th>
<th align="left" style="padding:8px;border-bottom:2px solid #333;">Line Total</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
<tr><td colspan="3" align="right" style="padding:8px;">Subtotal</td><td style="padding:8px;">${currency(totals.subtotal)}</td></tr>
<tr><td colspan="3" align="right" style="padding:8px;">Tax (${payload.totals.taxPercent}%)</td><td style="padding:8px;">${currency(totals.taxAmount)}</td></tr>
<tr><td colspan="3" align="right" style="padding:8px;"><strong>Grand Total</strong></td><td style="padding:8px;"><strong>${currency(totals.grandTotal)}</strong></td></tr>
</tfoot></table></div>`;}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error:"Method Not Allowed" }) };
  try {
    const payload = JSON.parse(event.body || "{}");
    const err = validatePayload(payload);
    if (err) return { statusCode: 400, body: JSON.stringify({ error: err }) };
    const totals = recomputeTotals(payload.items, payload.totals.taxPercent);

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, TO_EMAIL, FROM_EMAIL } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !TO_EMAIL)
      return { statusCode: 500, body: JSON.stringify({ error: "Email service not configured." }) };

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const subject = `New Order from ${payload.customer.name} — ${currency(totals.grandTotal)}`;
    const html = renderEmailHTML(payload, totals);
    const text = [
      `New Order`, `Customer: ${payload.customer.name}`, `Email: ${payload.customer.email}`,
      payload.customer.phone?`Phone: ${payload.customer.phone}`:"",
      payload.customer.address?`Address: ${payload.customer.address}`:"",
      payload.customer.orderDate?`Order Date: ${payload.customer.orderDate}`:"", ``,
      ...payload.items.map(i=>`- ${i.name} x${i.quantity} @ ${currency(i.unitPrice)} = ${currency(i.unitPrice*i.quantity)}`),
      ``, `Subtotal: ${currency(totals.subtotal)}`, `Tax (${payload.totals.taxPercent}%): ${currency(totals.taxAmount)}`,
      `Grand Total: ${currency(totals.grandTotal)}`
    ].filter(Boolean).join("\n");

    await transporter.sendMail({ from: FROM_EMAIL || SMTP_USER, to: TO_EMAIL, subject, text, html, replyTo: payload.customer.email });
    try { if (payload.customer.email) await transporter.sendMail({
      from: FROM_EMAIL || SMTP_USER, to: payload.customer.email, subject: `We received your order — ${subject}`,
      text: `Thanks ${payload.customer.name}, we received your order totaling ${currency(totals.grandTotal)}.`
    }); } catch {}

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error." }) };
  }
};
