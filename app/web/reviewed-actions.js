import { esc, label, money, busy, notice } from "./common.js";
const $ = (id) => document.getElementById(id);

export function mountReviewedActions({ request, onComplete }) {
  let alive = true,
    generation = 0;
  const panel = $("reviewed-actions");
  function show(content) {
    panel.hidden = false;
    panel.innerHTML = content;
    panel.scrollIntoView({ block: "start" });
  }
  function renderPreview({ preview: p, result }) {
    const terminal = result?.state && result.state !== "prepared";
    const canCheckOutcome =
      result?.state === "uncertain" ||
      (result?.localProjection === "pending" &&
        result.localProjectionReason !== "association_changed");
    show(`<h2 tabindex="-1" id="reviewed-heading">Review ${esc(label(p.kind))}</h2>
      <div id="reviewed-preview"><p>${esc(p.wording)}</p>
      <p>Request ${esc(p.rootId)} &middot; source version ${esc(p.source.version)}</p>
      ${p.text ? `<p>Exact Figma reply, including its visible tracking marker:</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.text)}</pre>` : ""}
      ${
        p.kind === "submit_for_client_approval"
          ? `<p>Proposal ${esc(p.orderId)}, revision ${p.revision} &middot; ${esc(p.title)}</p>
      <p>Scope ${esc(p.scope?.scopeRevisionId ?? "")} (v${esc(p.scope?.scopeVersion ?? "")}) &middot; Rates v${esc(p.scope?.rateVersion ?? "")}</p>
      ${p.itemIds?.length ? `<p>Reserved items: ${p.itemIds.map(esc).join(", ")}</p>` : ""}
      <ul>${(p.deliverables ?? []).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      <p>${money(p.totalMinor, p.currency)} (${p.totalMinor} minor units ${esc(p.currency)})</p>
      <ul>${(p.lineItems ?? []).map((i) => `<li>${i.quantity} &times; ${esc(i.description)} &middot; ${money(i.unitAmountMinor, p.currency)} each</li>`).join("")}</ul>`
          : ""
      }
      ${
        p.kind === "issue_approved_invoice" && p.approvedTerms
          ? `<p>Approved proposal ${esc(p.orderId)}, revision ${p.revision} &middot; Client approval recorded ${esc(new Date(p.approvalAt).toLocaleString())}</p>
      <p>Scope ${esc(p.scope?.scopeRevisionId ?? "")} &middot; Merchant ${esc(p.approvedTerms.merchantEmail)} (${esc(p.paypalEnv ?? "")}) &middot; Reference ${esc(p.approvedTerms.reference)}</p>
      <p>${money(p.approvedTerms.totalMinor, p.approvedTerms.currency)} (${p.approvedTerms.totalMinor} minor units ${esc(p.approvedTerms.currency)})</p>
      <ul>${p.approvedTerms.lineItems.map((i) => `<li>${i.quantity} &times; ${esc(i.description)} &middot; ${money(i.unitAmountMinor, p.approvedTerms.currency)} each</li>`).join("")}</ul>`
          : ""
      }
      ${
        p.invoiceId && p.notification
          ? `<p>Invoice ${esc(p.invoiceId)} &middot; Proposal ${esc(p.orderId)}, revision ${p.revision}</p>
      <p>${money(p.approvedTerms.totalMinor, p.approvedTerms.currency)}</p><ul>${p.approvedTerms.lineItems.map((i) => `<li>${i.quantity} &times; ${esc(i.description)} &middot; ${money(i.unitAmountMinor, p.approvedTerms.currency)} each</li>`).join("")}</ul>
      <p>Payer: ${p.notification.send_to_recipient ? esc(p.recipients.primary.join(", ")) : "No notification"}<br>Merchant: ${p.notification.send_to_invoicer ? esc(p.recipients.merchant) : "No notification"}<br>Existing CCs: ${p.recipients.cc.length ? esc(p.recipients.cc.join(", ")) : "None"}</p>`
          : ""
      }
      <p>Review expires ${esc(new Date(p.expiresAt).toLocaleString())}. Changed terms require a new preview.</p></div>
      <p id="reviewed-outcome" role="status">${terminal ? esc(result.message ?? label(result.state)) : ""}</p>
      ${result?.approvalUrl ? `<div id="reviewed-client-link" class="notice"><label for="reviewed-approval-link">Private client review link</label><input id="reviewed-approval-link" readonly value="${esc(result.approvalUrl)}"><a id="reviewed-open-approval" href="${esc(result.approvalUrl)}" target="_blank" rel="noreferrer">Open client review</a></div>` : ""}
      ${canCheckOutcome ? `<button id="reviewed-check-outcome" type="button" class="secondary">Check provider outcome</button>` : ""}
      ${terminal ? "" : `<form id="reviewed-confirm-form" method="post" action="/api/reviewed-actions/${esc(p.id)}/confirm"><label class="check consent" for="reviewed-consent"><input id="reviewed-consent" type="checkbox" required><span>I reviewed this exact action, text, invoice terms and recipients and authorize it once.</span></label><button id="reviewed-confirm" type="submit">Confirm ${esc(label(p.kind))}</button></form>`}
      ${result?.providerId ? `<p>Provider reply ${esc(result.providerId)} in thread ${esc(p.rootId)}.</p><button id="reviewed-thread-refresh" type="button" class="secondary">Refresh reply thread for reassessment</button>` : ""}
      <button id="reviewed-close" type="button" class="secondary">Close review</button>`);
    $("reviewed-heading").focus();
    $("reviewed-close").onclick = () => {
      generation++;
      panel.hidden = true;
    };
    if (canCheckOutcome) {
      $("reviewed-check-outcome").onclick = (e) => {
        const epoch = generation;
        busy(e.currentTarget, async () => {
          const outcome = await request(
            "/api/reviewed-actions/" + encodeURIComponent(p.id) + "/confirm",
            "POST",
            { previewHash: p.previewHash, consent: true },
          );
          if (!alive || epoch !== generation) return;
          renderPreview({ preview: p, result: outcome });
          await onComplete?.();
        });
      };
    }
    if (result?.providerId) {
      $("reviewed-thread-refresh").onclick = (e) =>
        busy(e.currentTarget, async () => {
          await request("/api/inbox/refresh", "POST", { commentId: p.rootId });
          await onComplete?.();
          notice(
            "Reply thread refreshed. Review its current request items before any reassessment.",
          );
        });
    }
    if (terminal) return;
    $("reviewed-confirm-form").onsubmit = (e) => {
      e.preventDefault();
      const epoch = generation;
      busy($("reviewed-confirm"), async () => {
        try {
          const outcome = await request(
            "/api/reviewed-actions/" + encodeURIComponent(p.id) + "/confirm",
            "POST",
            {
              previewHash: p.previewHash,
              consent: $("reviewed-consent").checked,
            },
          );
          if (!alive || epoch !== generation) return;
          renderPreview({ preview: p, result: outcome });
          await onComplete?.();
        } catch (error) {
          if (!alive || epoch !== generation) return;
          // A lost HTTP response is not permission to create a fresh send.
          $("reviewed-confirm-form").hidden = true;
          $("reviewed-outcome").textContent =
            error.message +
            " Reopen this recorded action to inspect its result before preparing another.";
          const link = document.createElement("a");
          link.href = p.reviewUrl;
          link.textContent = "Open recorded action";
          panel.append(link);
          throw error;
        }
      });
    };
  }
  async function openAction(id) {
    const epoch = ++generation,
      value = await request("/api/reviewed-actions/" + encodeURIComponent(id));
    if (alive && epoch === generation) renderPreview(value);
  }
  function openThread(thread) {
    const epoch = ++generation;
    const options = [
      ...(thread.sourceKind === "figma"
        ? [["post_clarification", "Post clarification"]]
        : []),
      ...(thread.orders.filter((o) => o.approvalState === "approved").length
        ? [
            ["remind_invoice", "Remind invoice"],
            ["cancel_invoice", "Cancel invoice"],
          ]
        : []),
    ];
    if (!options.length) {
      notice(
        "This request needs an approved linked invoice before invoice actions.",
        true,
      );
      return;
    }
    show(`<h2 tabindex="-1" id="reviewed-heading">Prepare a reviewed action</h2><p>Preparation reads the authoritative thread and invoice. Nothing is sent until you review and confirm the saved preview.</p>
      <form id="reviewed-prepare-form" method="post" action="/api/reviewed-actions"><label for="reviewed-kind">Action</label><select id="reviewed-kind">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>
      <div id="reviewed-question"><label for="reviewed-text">Exact clarification question</label><textarea id="reviewed-text" maxlength="3500" rows="4"></textarea></div>
      <fieldset id="reviewed-invoice"><legend>Exact invoice and notification choices</legend><label for="reviewed-order">Approved proposal revision</label><select id="reviewed-order">${thread.orders
        .filter((o) => o.approvalState === "approved")
        .map(
          (o) =>
            `<option value="${esc(o.order_id)}:${o.revision}">${esc(o.order_id)}, revision ${o.revision}</option>`,
        )
        .join("")}</select>
      <p>PayPal uses system wording. Reminders require 24 hours after approval and between attempts; provider limits and any unresolved prior send also apply.</p>
      <label class="check" for="reviewed-buyer"><input id="reviewed-buyer" type="checkbox"><span>Notify this invoice's payer</span></label><label class="check" for="reviewed-merchant"><input id="reviewed-merchant" type="checkbox"><span>Notify this invoice's merchant</span></label>
      <label for="reviewed-cc">All existing invoice CC addresses, comma separated (leave empty only when the invoice has none)</label><input id="reviewed-cc" autocomplete="off" maxlength="25500"><small>Only the complete existing CC set is supported. No new addresses are allowed. Cancellation with no selected recipients is silent.</small></fieldset>
      <button id="reviewed-prepare" type="submit">Prepare preview</button></form>`);
    function selectKind() {
      const question = $("reviewed-kind").value === "post_clarification";
      $("reviewed-question").hidden = !question;
      $("reviewed-text").required = question;
      $("reviewed-invoice").hidden = question;
    }
    $("reviewed-kind").onchange = selectKind;
    selectKind();
    $("reviewed-heading").focus();
    $("reviewed-prepare-form").onsubmit = (e) => {
      e.preventDefault();
      busy($("reviewed-prepare"), async () => {
        const kind = $("reviewed-kind").value,
          input = {
            kind,
            requestId: thread.id,
            expected: {
              requestVersion: thread.requestVersion,
              source: thread.source,
            },
          };
        if (kind === "post_clarification")
          input.text = $("reviewed-text").value;
        else {
          const selected = thread.orders.find(
            (o) => o.order_id + ":" + o.revision === $("reviewed-order").value,
          );
          input.orderId = selected.order_id;
          input.revision = selected.revision;
          input.recipients = {
            sendToRecipient: $("reviewed-buyer").checked,
            sendToInvoicer: $("reviewed-merchant").checked,
            additionalRecipients: $("reviewed-cc")
              .value.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
        }
        const preview = await request("/api/reviewed-actions", "POST", input);
        if (alive && epoch === generation)
          renderPreview({ preview, result: { state: "prepared" } });
      });
    };
  }
  return {
    openThread,
    openAction,
    destroy() {
      alive = false;
      generation++;
      panel.hidden = true;
      panel.replaceChildren();
    },
  };
}
