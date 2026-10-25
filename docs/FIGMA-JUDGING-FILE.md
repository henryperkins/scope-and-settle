# Synthetic judging file and recovery

> File-binding and invoice observations below come from the October 24, 2026 `codex/paid-figma-connection` verification snapshot, consolidated October 25. The three dated records preserve the tested build, operations, and remaining access boundary.

The October 24, 2026 hosted-file migration designated [Scope & Settle — Demo (Copy)](https://www.figma.com/design/xu9KUICNauIGSzSepzGvBE/Scope-and-Settle?node-id=5-2), file key `xu9KUICNauIGSzSepzGvBE`, in **Henry Perkins’s team → Scope & Settle**. At that check, Figma reported a Professional team and a Full seat for the owner. Its checkout frame is node `5:2`, named **Desktop checkout — synthetic demo**. After the owner's usability updates, it measured 1200 × 995, with a Margin stationery checkout, synthetic Alex Morgan contact details, separate state/ZIP fields, a collapsed discount entry, and a $30 product order summary including $6 shipping. The recorded recovery-state examples are in frame `2012:53`. This product price is background design content; the separate mobile-design change order is $250.

The October 24 records identify the copy’s actual request **Can you add the mobile checkout?**, comment ID `1980028284`, anchored to frame `5:2`. On October 24, the native plugin loaded that comment, attached a fresh PNG of the updated checkout, and completed a live assessment: **New work**, with the existing $250 mobile-layout rate and quantity 1. See [assessment verification](FIGMA-ASSESSMENT-2026-10-24.md) and [connection verification](FIGMA-CONNECTION-2026-10-24.md). At the migration checkpoint, a fresh judging entry and designer run used this copy; previous entry links and runs retained their original file snapshots and paid orders. The desktop-only brief and $250 mobile-layout rate stayed unchanged during that migration.

The owner then authorized confirming the $250 terms and testing approval and invoice creation. At the October 24 invoice-flow check, revision 1 had recorded client approval and PayPal sandbox invoice `INV2-2JCE-LWQA-NX3U-WJVH`, with $250 due. The native plugin and client review both showed **Payment due**. This is a dated invoice observation; it does not establish the invoice’s present balance. See [invoice-flow verification](FIGMA-INVOICE-FLOW-2026-10-24.md).

The original [Scope & Settle — Demo](https://www.figma.com/design/5SA05oDiVVe8mv57NYvaHt/Scope-and-Settle), file key `5SA05oDiVVe8mv57NYvaHt`, remains historical evidence. Its request **Can you add the mobile checkout?**, comment ID `1978367271`, was not copied into the new file. Do not reuse that comment ID against the copy.

## Recoverable assets

- [`fixtures/figma-checkout.svg`](../fixtures/figma-checkout.svg) is a self-contained Figma export with editable text and vector shapes. Import it into Figma to recover the historical 1200 × 982 design; it predates the paid-team copy’s 1200 × 995 usability updates. It uses Inter and Instrument Serif. All text, colors, coordinates and vectors are included; no remote image URL is required.
- [`fixtures/figma-checkout.json`](../fixtures/figma-checkout.json) is the original REST node snapshot, captured October 23, 2026 UTC. It preserves the 157-node structure, geometry, text styles, layout, paint values and component references for inspection. It is reference data, not a `.fig` archive. It contains only the designated synthetic frame.

## Restore the original historical judging frame

1. Open the original historical file `5SA05oDiVVe8mv57NYvaHt` with edit permission and duplicate its current frame as a temporary recovery copy.
2. Keep the original frame node `5:2` so its actual comment remains attached. Set it to 1200 × 982. Replace its child content with the imported SVG, positioned at x=0, y=0 within the frame. Figma imports SVG as editable vector/text content; this preserves appearance, not reusable component/variable bindings.
3. Confirm the real comment still reads **Can you add the mobile checkout?** and belongs to this frame. Select the original frame, run the plugin, and attach it. The preview should show the checkout.
4. Remove the temporary recovery copy only after checking the restored original. Keep the supplied brief and rate card fixed for judging.

## Recreate in a new Figma file

Import the SVG, wrap it in a 1200 × 982 frame named **Desktop checkout — synthetic demo**, and post the exact comment above on that frame. The synthetic desktop page contains a header, contact/shipping form, details/payment/review progress steps, stationery bag summary, and footer; the SVG is the complete visual source.

A new file has a different key and comment ID. Update `FIGMA_FILE_KEY` and the configured `projects.figma_file_key` through an administrator migration, confirm the Figma token can read its comments, and provision a **new** judging entry credential. Existing entry credentials freeze their prior project/file snapshot; do not quietly redirect their proposals to another file. Run a complete assessment and native attachment check before replacing submitted instructions.

## Historical permission acceptance (original file)

On October 23, 2026 UTC, the existing file was moved from owner Drafts into **Scope & Settle Judging → Team folder** on the free Starter plan, and its link setting was saved as **Anyone can edit**. The file key, frame ID and real comment were preserved. No paid plan, trial or paid seat was purchased. A separately created, verified Figma test account opened the editor and changed the selected frame's X position from 0 to 1 and back to 0. That proves independent edit access. The same account subsequently installed the exact released 0.2.1 ZIP in Desktop, exported the selected frame and restored the existing Paid revision after reopening; see [native acceptance](JUDGING-VERIFICATION-2026-10-23.md#final-zip-acceptance-under-the-separate-figma-account).

The native plugin requires a judge's own Figma account to open the designated file with edit access and Figma desktop to import the development plugin. A view-only link is insufficient. Opening the file as its owner does not prove another account can edit it. The October 23 independent-account result above applies to the original file only; independent edit access to the paid-team copy was not verified in the October 24 records. Record a separate successful check before directing judges to that file.

The development manifest enables `enablePrivatePluginApi` so Figma exposes `figma.fileKey` for the file identity check. See [Figma manifest documentation](https://developers.figma.com/docs/plugins/manifest/) and [`figma.fileKey`](https://developers.figma.com/docs/plugins/api/figma/).
