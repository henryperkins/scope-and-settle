// Scope & Settle — Figma plugin main code.
// Runs in Figma's main thread: owns document access, talks to the UI iframe.

figma.showUI(__html__, { width: 440, height: 720, title: "Scope & Settle" });

function selectionSummary() {
  return figma.currentPage.selection.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    width: "width" in n ? Math.round(n.width) : null,
    height: "height" in n ? Math.round(n.height) : null,
  }));
}

figma.ui.onmessage = async (msg: { type?: string; session?: unknown }) => {
  if (msg.type === "save-session") await figma.clientStorage.setAsync("designer-session", msg.session);
  if (msg.type === "get-session") figma.ui.postMessage({ type: "session", session: await figma.clientStorage.getAsync("designer-session") });
  if (msg.type === "export-frame") {
    try {
      const nodes = figma.currentPage.selection;
      if (nodes.length !== 1 || nodes[0].type !== "FRAME") throw new Error("Select one frame in Figma before attaching it.");
      const bytes = await nodes[0].exportAsync({ format: "PNG", constraint: { type: "WIDTH", value: 1000 } });
      if (bytes.length > 1_500_000) throw new Error("This frame is too large. Select a smaller frame.");
      figma.ui.postMessage({ type: "frame", dataUrl: "data:image/png;base64," + figma.base64Encode(bytes), context: selectionSummary() });
    } catch (error) { figma.ui.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  }
  if (msg.type === "get-context") {
    figma.ui.postMessage({
      type: "context",
      fileKey: figma.fileKey,
      pageName: figma.currentPage.name,
      selection: selectionSummary(),
    });
  }
  if (msg.type === "resize") {
    figma.ui.resize(420, 640);
  }
};

figma.on("selectionchange", () => {
  figma.ui.postMessage({ type: "selection", selection: selectionSummary() });
});
